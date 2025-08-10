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

let localStream;

const VoiceAssistant = () => {
  const [isMicActive, setIsMicActive] = useState(false);
  const [micStream, setMicStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [dataChannel, setDataChannel] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [audioWave, setAudioWave] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);

  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const analyserRef = useRef(null);
  const audioPlayerRef = useRef(null);

  const { setAudioUrl, stopAudio } = useAudioStore();
  const { audioScale } = useAudioForVisualizerStore();

  useEffect(() => {
    return () => {
      micStream?.getTracks().forEach((track) => track.stop());
      peerConnection?.close();
      dataChannel?.close();
      setMicStream(null);
      setPeerConnection(null);
      setDataChannel(null);
      setConnectionStatus("idle");
      setIsMicActive(false);
    };
  }, [dataChannel, micStream, peerConnection]);

  const startWebRTC = async () => {
    if (peerConnection || connectionStatus === "connecting") return;

    setConnectionStatus("connecting");
    setIsMicActive(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { setAudioScale } = useAudioForVisualizerStore.getState();
      startVolumeMonitoring(stream, setAudioScale);

      localStream = stream;
      stream.getAudioTracks().forEach((track) => (track.enabled = true));

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!audioPlayerRef.current) return;

        audioPlayerRef.current.srcObject = stream;
        setAudioUrl(stream);
        setRemoteStream(stream);

        audioPlayerRef.current
          .play()
          .catch((err) => console.error("live stream play failed:", err));
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          pc.close();
          setConnectionStatus("error");
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "closed" || pc.connectionState === "failed") {
          setConnectionStatus("error");
          setIsMicActive(false);
        }
      };

      stream.getAudioTracks().forEach((track) => pc.addTrack(track, localStream));

      const channel = pc.createDataChannel("response");

      channel.onopen = () => {
        setConnectionStatus("connected");
        setIsMicActive(true);
        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "hola" }],
            },
          })
        );
        channel.send(JSON.stringify({ type: "response.create" }));
        micStream?.getAudioTracks().forEach((track) => (track.enabled = true));
      };

      channel.onclose = () => {
        setConnectionStatus("idle");
        setIsMicActive(false);
      };

      channel.onerror = (error) => {
        console.error("❌ Data channel error:", error);
        setConnectionStatus("error");
        setIsMicActive(false);
      };

      let pcmBuffer = new ArrayBuffer(0);

      channel.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "response.audio.delta": {
            const chunk = Uint8Array.from(atob(msg.delta), (c) => c.charCodeAt(0));
            const tmp = new Uint8Array(pcmBuffer.byteLength + chunk.byteLength);
            tmp.set(new Uint8Array(pcmBuffer), 0);
            tmp.set(chunk, pcmBuffer.byteLength);
            pcmBuffer = tmp.buffer;
            break;
          }
          case "response.audio.done": {
            const wav = encodeWAV(pcmBuffer, 24000, 1);
            const blob = new Blob([wav], { type: "audio/wav" });
            const url = URL.createObjectURL(blob);

            const el = audioPlayerRef.current;
            el.src = url;
            el.volume = 1;
            el.muted = false;

            if (!audioContextRef.current) {
              audioContextRef.current = new (window.AudioContext ||
                window.webkitAudioContext)();
            }

            if (!audioSourceRef.current) {
              audioSourceRef.current = audioContextRef.current.createMediaElementSource(el);
              analyserRef.current = audioContextRef.current.createAnalyser();
              audioSourceRef.current.connect(analyserRef.current);
              analyserRef.current.connect(audioContextRef.current.destination);
              analyserRef.current.smoothingTimeConstant = 0.8;
              analyserRef.current.fftSize = 256;
            }

            const analyser = analyserRef.current;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const { setAudioScale } = useAudioForVisualizerStore.getState();

            const monitorBotVolume = () => {
              analyser.getByteFrequencyData(dataArray);
              const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
              const normalized = Math.max(0.5, Math.min(2, avg / 50));
              setAudioScale(normalized);

              if (!el.paused && !el.ended) {
                requestAnimationFrame(monitorBotVolume);
              }
            };

            monitorBotVolume();
            setAudioWave(true);
            el.play().catch((err) => console.error("❌ play error:", err.name, err.message));

            pcmBuffer = new ArrayBuffer(0);
            break;
          }
          case "output_audio_buffer.stopped":
            setAudioWave(false);
            stopAudio();
            break;
          default:
            break;
        }
      };

      let offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      const modifiedOffer = {
        ...offer,
        sdp: offer.sdp.replace(
          /a=rtpmap:\d+ opus\/48000\/2/g,
          "a=rtpmap:111 opus/48000/2\r\n" +
            "a=fmtp:111 minptime=10;useinbandfec=1"
        ),
      };

      await pc.setLocalDescription(modifiedOffer);

      const res = await fetch(
        "https://voiceassistant-mode-webrtc-server.onrender.com/api/rtc-connect",
        {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offer.sdp,
        }
      );

      if (!res.ok) throw new Error(`Server responded ${res.status}`);

      const answer = await res.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      setPeerConnection(pc);
      setDataChannel(channel);
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
    if (connectionStatus === "connected" && localStream) {
      const newMicState = !isMicActive;
      setIsMicActive(newMicState);
      localStream.getAudioTracks().forEach((track) => (track.enabled = newMicState));
    }
  };

  return (
    <div className="voice-assistant-wrapper">
      <audio ref={audioPlayerRef} playsInline style={{ display: "none" }} controls={false} autoPlay />

      {/* ORB */}
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

