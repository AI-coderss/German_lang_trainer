/* eslint-disable no-unused-vars */
import React, { useEffect, useRef, useState } from "react";
import BaseOrb from "./BaseOrb";
import AudioWave from "./AudioWave";
import { FaMicrophoneAlt } from "react-icons/fa";
import useAudioForVisualizerStore from "../store/useAudioForVisualizerStore";
import "../styles/voiceassistant.css";
import { encodeWAV } from "./pcmToWav";
import useAudioStore from "../store/audioStore";
import { startVolumeMonitoring } from "./audioLevelAnalyzer";

const SIGNAL_URL ="https://patient-ai-assistant-new-version-backend.onrender.com/api/rtc-connect";

/** Use refs for live WebRTC objects (avoid rerender races) */
const pcRef = { current: null };
const dcRef = { current: null };
const localStreamRef = { current: null };

const VoiceAssistant = () => {
  const [isMicActive, setIsMicActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [remoteStream, setRemoteStream] = useState(null);

  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const analyserRef = useRef(null);
  const audioPlayerRef = useRef(null);

  const { setAudioUrl, stopAudio } = useAudioStore();
  const { audioScale } = useAudioForVisualizerStore();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        pcRef.current?.close();
        dcRef.current?.close();
      } catch (e) {}
      pcRef.current = null;
      dcRef.current = null;
      localStreamRef.current = null;
      setConnectionStatus("idle");
      setIsMicActive(false);
    };
  }, []);

  /** Utility: wait for ICE gathering to complete (non-trickle servers) */
  const waitForIceGatheringComplete = (pc) =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const check = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", check);
    });

  const startWebRTC = async () => {
    if (pcRef.current || connectionStatus === "connecting") return;

    setConnectionStatus("connecting");
    setIsMicActive(false);

    try {
      // 1) Mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const { setAudioScale } = useAudioForVisualizerStore.getState();
      startVolumeMonitoring(stream, setAudioScale);

      stream.getAudioTracks().forEach((track) => (track.enabled = true));

      // 2) PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      // Offer to receive audio RTP from server explicitly
      pc.addTransceiver("audio", { direction: "sendrecv" });

      // Add our mic tracks
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      // Remote audio → play & send to visualizer
      pc.ontrack = (event) => {
        const [rs] = event.streams;
        if (!rs) return;
        setRemoteStream(rs);
        if (audioPlayerRef.current) {
          audioPlayerRef.current.srcObject = rs;
          audioPlayerRef.current
            .play()
            .catch((err) => console.error("Audio element play failed:", err));
        }
        setAudioUrl(rs);
      };

      pc.oniceconnectionstatechange = () => {
        console.log("ICE state:", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed") {
          pc.close();
          setConnectionStatus("error");
        }
      };
      pc.onsignalingstatechange = () =>
        console.log("Signaling:", pc.signalingState);
      pc.onconnectionstatechange = () => {
        console.log("PC state:", pc.connectionState);
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
          setConnectionStatus("error");
          setIsMicActive(false);
        }
      };

      // 3) DataChannel
      const channel = pc.createDataChannel("response", { ordered: true });
      dcRef.current = channel;

      channel.onopen = () => {
        console.log("✅ DataChannel open");
        setConnectionStatus("connected");
        setIsMicActive(true);

        // IMPORTANT: tell the server we want audio/text, and enable VAD
        const sessionUpdate = {
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            turn_detection: "vad",
            input_audio_format: { type: "pcm16", sample_rate_hz: 16000 },
            output_audio_format: { type: "wav", sample_rate_hz: 24000 },
          },
        };
        channel.send(JSON.stringify(sessionUpdate));

        // Ask for a response stream
        const createResponse = {
          type: "response.create",
          response: { modalities: ["audio", "text"] },
        };
        channel.send(JSON.stringify(createResponse));
      };

      channel.onclose = () => {
        console.log("DataChannel closed");
        setConnectionStatus("idle");
        setIsMicActive(false);
      };

      channel.onerror = (error) => {
        console.error("❌ DataChannel error:", error);
        setConnectionStatus("error");
        setIsMicActive(false);
      };

      // 4) Messages from server
      let pcmBuffer = new ArrayBuffer(0);
      channel.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Uncomment to debug:
          // console.log("DC message:", msg);

          switch (msg.type) {
            case "response.text.delta":
              // Optional: stream text if you want to display it
              break;

            case "response.audio.delta": {
              // PCM base64 chunks → concat until done
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
              // Create WAV blob and play (for data-channel audio path)
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

                const analyser = analyserRef.current;
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                const { setAudioScale } =
                  useAudioForVisualizerStore.getState();

                const monitorBotVolume = () => {
                  analyser.getByteFrequencyData(dataArray);
                  const avg =
                    dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
                  const normalized = Math.max(0.5, Math.min(2, avg / 50));
                  setAudioScale(normalized);
                  if (!el.paused && !el.ended)
                    requestAnimationFrame(monitorBotVolume);
                };

                monitorBotVolume();
                el.play().catch((err) =>
                  console.error("play error:", err.name, err.message)
                );
              }

              pcmBuffer = new ArrayBuffer(0);
              break;
            }

            case "conversation.item.input_audio_transcription.completed":
              // If you want the partial transcript, read msg.transcript
              break;

            case "output_audio_buffer.stopped":
              stopAudio();
              break;

            default:
              // console.log("Unhandled:", msg.type);
              break;
          }
        } catch (e) {
          console.warn("Non-JSON message or parse error:", e);
        }
      };

      // 5) Offer/Answer — send EXACT localDescription.sdp after ICE gathering
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const sdpToSend = pc.localDescription?.sdp || offer.sdp; // keep in sync
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
      startWebRTC();
      return;
    }
    if (connectionStatus === "connected" && localStreamRef.current) {
      const next = !isMicActive;
      setIsMicActive(next);
      localStreamRef.current
        .getAudioTracks()
        .forEach((t) => (t.enabled = next));
      console.log(`Microphone ${next ? "enabled" : "disabled"}`);
    }
  };

  return (
    <div className="voice-assistant-wrapper">
      <audio
        ref={audioPlayerRef}
        playsInline
        style={{ display: "none" }}
        controls={false}
        autoPlay
      />

      {/* ORB */}
      <div className="voice-stage-orb">
        <BaseOrb />
      </div>

      {/* AUDIO WAVE */}
      <div className="voice-stage-wave">
        <AudioWave stream={remoteStream} audioUrl={null} />
      </div>

      {/* MIC */}
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


