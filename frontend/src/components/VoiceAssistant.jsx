/* eslint-disable no-unused-vars */
// src/components/VoiceAssistant.jsx
import React, { useEffect, useRef, useState } from "react";
import BaseOrb from "./BaseOrb";
import AudioWave from "./AudioWave";
import { FaMicrophoneAlt } from "react-icons/fa";
import useAudioForVisualizerStore from "../store/useAudioForVisualizerStore";
import "../styles/voiceassistant.css";
import { encodeWAV } from "./pcmToWav";
import useAudioStore from "../store/audioStore";
import { startVolumeMonitoring } from "./audioLevelAnalyzer";

/** Direct backend URL (no import.meta.env) */
const SIGNAL_URL =
  "https://patient-ai-assistant-new-version-backend.onrender.com/api/rtc-connect";

const VoiceAssistant = () => {
  // UI state
  const [isMicActive, setIsMicActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [remoteStream, setRemoteStream] = useState(null);

  // Live refs for WebRTC primitives (avoid state races)
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);

  // Audio processing / visualizer refs
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const analyserRef = useRef(null);
  const audioPlayerRef = useRef(null);

  // Stores
  const { setAudioUrl, stopAudio } = useAudioStore();
  useAudioForVisualizerStore(); // subscribe to store (orb reads directly)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        pcRef.current?.close();
        dcRef.current?.close();
      } catch (_) {}
      pcRef.current = null;
      dcRef.current = null;
      localStreamRef.current = null;
      setConnectionStatus("idle");
      setIsMicActive(false);
    };
  }, []);

  const startWebRTC = async () => {
    if (pcRef.current || connectionStatus === "connecting") return;

    setConnectionStatus("connecting");
    setIsMicActive(false);

    try {
      // 1) Get mic quickly (browser-friendly constraints)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      // Kick off the volume monitor for the orb
      const { setAudioScale } = useAudioForVisualizerStore.getState();
      startVolumeMonitoring(stream, setAudioScale);
      stream.getAudioTracks().forEach((t) => (t.enabled = true));

      // 2) Create RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
      pcRef.current = pc;

      // Ensure we can receive server audio downlink
      pc.addTransceiver("audio", { direction: "sendrecv" });

      // Add our mic tracks
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      // Remote audio → play + provide to AudioWave
      pc.ontrack = (event) => {
        const [rs] = event.streams || [];
        if (!rs) return;
        setRemoteStream(rs);
        if (audioPlayerRef.current) {
          audioPlayerRef.current.srcObject = rs;
          audioPlayerRef.current
            .play()
            .catch((e) => console.warn("Audio play failed:", e));
        }
        setAudioUrl(rs);
      };

      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === "failed") {
          pc.close();
          setConnectionStatus("error");
        }
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === "failed" || st === "disconnected" || st === "closed") {
          setConnectionStatus("error");
          setIsMicActive(false);
        }
      };

      // 3) Data Channel
      const dc = pc.createDataChannel("response", { ordered: true });
      dcRef.current = dc;

      dc.onopen = () => {
        // Opened quickly → flip mic green
        setConnectionStatus("connected");
        setIsMicActive(true);

        // Minimal fast bootstrap so the server starts talking
        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              modalities: ["text", "audio"],
              turn_detection: "vad",
              // optional formats; most stacks default well without these:
              // input_audio_format: { type: "pcm16", sample_rate_hz: 16000 },
              // output_audio_format: { type: "wav", sample_rate_hz: 24000 },
            },
          })
        );

        dc.send(
          JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio", "text"] },
          })
        );
      };

      dc.onclose = () => {
        setConnectionStatus("idle");
        setIsMicActive(false);
      };

      dc.onerror = (error) => {
        console.error("❌ DataChannel error:", error);
        setConnectionStatus("error");
        setIsMicActive(false);
      };

      // 4) Handle messages (text/audio via data channel)
      let pcmBuffer = new ArrayBuffer(0);
      dc.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "response.text.delta":
              // If you want to display captions, accumulate here
              break;

            case "response.audio.delta": {
              const chunk = Uint8Array.from(atob(msg.delta), (c) =>
                c.charCodeAt(0)
              );
              const tmp = new Uint8Array(
                pcmBuffer.byteLength + chunk.byteLength
              );
              tmp.set(new Uint8Array(pcmBuffer), 0);
              tmp.set(chunk, pcmBuffer.byteLength);
              pcmBuffer = tmp.buffer;
              break;
            }

            case "response.audio.done": {
              // Create WAV blob and play (data-channel audio path)
              const wav = encodeWAV(pcmBuffer, 24000, 1);
              const blob = new Blob([wav], { type: "audio/wav" });
              const url = URL.createObjectURL(blob);

              const el = audioPlayerRef.current;
              if (el) {
                el.src = url;
                el.volume = 1;
                el.muted = false;

                if (!audioContextRef.current) {
                  audioContextRef.current = new (window.AudioContext ||
                    window.webkitAudioContext)();
                }
                if (!audioSourceRef.current) {
                  audioSourceRef.current =
                    audioContextRef.current.createMediaElementSource(el);
                  analyserRef.current =
                    audioContextRef.current.createAnalyser();
                  audioSourceRef.current.connect(analyserRef.current);
                  analyserRef.current.connect(
                    audioContextRef.current.destination
                  );
                  analyserRef.current.smoothingTimeConstant = 0.8;
                  analyserRef.current.fftSize = 256;
                }

                // Drive orb on playback
                const analyser = analyserRef.current;
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                const { setAudioScale } =
                  useAudioForVisualizerStore.getState();
                const monitor = () => {
                  analyser.getByteFrequencyData(dataArray);
                  const avg =
                    dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                  const normalized = Math.max(0.5, Math.min(2, avg / 50));
                  setAudioScale(normalized);
                  if (!el.paused && !el.ended) requestAnimationFrame(monitor);
                };
                monitor();

                el.play().catch((err) =>
                  console.error("play error:", err.name, err.message)
                );
              }

              pcmBuffer = new ArrayBuffer(0);
              break;
            }

            case "output_audio_buffer.stopped":
              stopAudio();
              break;

            default:
              // console.log("Unhandled:", msg.type);
              break;
          }
        } catch (e) {
          // Non-JSON or parse error
        }
      };

      // 5) FAST OFFER/ANSWER (no ICE wait)
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      // Send EXACTLY what we've set on the PC to avoid SDP mismatches
      const sdpToSend = pc.localDescription?.sdp || offer.sdp;
      const res = await fetch(SIGNAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: sdpToSend,
      });
      if (!res.ok) throw new Error(`Signaling failed: ${res.status}`);

      const answer = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (error) {
      console.error("🚫 WebRTC setup failed:", error);
      setConnectionStatus("error");
      setIsMicActive(false);
    }
  };

  const toggleMic = () => {
    if (connectionStatus === "idle" || connectionStatus === "error") {
      // Start and connect quickly
      startWebRTC();
      return;
    }
    if (connectionStatus === "connected" && localStreamRef.current) {
      const next = !isMicActive;
      setIsMicActive(next);
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next));
    }
  };

  return (
    <div className="voice-assistant-wrapper">
      {/* Hidden audio element for remote audio */}
      <audio
        ref={audioPlayerRef}
        playsInline
        style={{ display: "none" }}
        controls={false}
        autoPlay
      />

      {/* ORB (top) */}
      <div className="voice-stage-orb">
        <BaseOrb />
      </div>

      {/* AUDIO WAVE (center) */}
      <div className="voice-stage-wave">
        <AudioWave stream={remoteStream} audioUrl={null} />
      </div>

      {/* MIC (bottom center) */}
      <div className="mic-controls">
        {connectionStatus === "connecting" && (
          <div className="connection-status">🔄 Connecting…</div>
        )}
        <button
          className={`mic-icon-btn ${isMicActive ? "active" : "inactive"}`}
          onClick={toggleMic}
          disabled={connectionStatus === "connecting"}
          aria-pressed={isMicActive}
          aria-label={isMicActive ? "Mute microphone" : "Start voice session"}
          title={isMicActive ? "Mic On" : "Mic Off"}
        >
          <FaMicrophoneAlt />
        </button>
      </div>
    </div>
  );
};

export default VoiceAssistant;



