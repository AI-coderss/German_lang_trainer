/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
// src/components/VoiceAssistant.jsx
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
// src/components/VoiceAssistant.jsx
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
// src/components/VoiceAssistant.jsx
import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import BaseOrb from "./BaseOrb";
import { FaMicrophoneAlt } from "react-icons/fa";
import useAudioForVisualizerStore from "../store/useAudioForVisualizerStore";
import "../styles/voiceassistant.css";
import { encodeWAV } from "./pcmToWav";
import useAudioStore from "../store/audioStore";
import { startVolumeMonitoring } from "./audioLevelAnalyzer";
import AudioWave from "./AudioWave"; // ✅ added
import ReactMarkdown from "react-markdown";

/** Direct backend URL (no import.meta.env) */
const SIGNAL_URL = "http://127.0.0.1:8813/api/rtc-connect";

/* utils */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const BAR_COUNT = 28; // responsive columns

export default function VoiceAssistant() {
  // Connection & mic
  const [isMicActive, setIsMicActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("idle");

  // ---- STREAMING TRANSCRIPT (reliable, like your example) ----
  const [segments, setSegments] = useState([]); // [{id, text, final}]
  const [liveLine, setLiveLine] = useState(""); // current streaming text
  const responseMapRef = useRef(new Map());     // response_id -> { textBuf, audioBuf }
  const transcriptBodyRef = useRef(null);

  // Draggable cover
  const panelRef = useRef(null);
  const [coverY, setCoverY] = useState(0);
  const [maxY, setMaxY] = useState(0);
  const dragInfo = useRef({ dragging: false, startY: 0, startCoverY: 0 });

  // WebRTC primitives
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);

  // Audio pipeline (for bars)
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const analyserRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const freqDataRef = useRef(null);
  const animRafRef = useRef(0);
  const barElsRef = useRef([]);

  const { setAudioUrl, stopAudio } = useAudioStore();
  useAudioForVisualizerStore(); // keeps orb reactive to volume

  /* ----------------- Measure panel to set drag bounds ----------------- */
  useLayoutEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const ph = panel.clientHeight;
      const lip = 48; // keep handle visible when fully closed
      const range = Math.max(0, ph - lip);
      setMaxY(range);
      setCoverY((y) => clamp(y, 0, range));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (panelRef.current) ro.observe(panelRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* -------------------------- Drag mechanics -------------------------- */
  const onPointerDown = (e) => {
    e.preventDefault();
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    dragInfo.current = { dragging: true, startY: clientY, startCoverY: coverY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };
  const onPointerMove = (e) => {
    if (!dragInfo.current.dragging) return;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const dy = clientY - dragInfo.current.startY;
    setCoverY(clamp(dragInfo.current.startCoverY + dy, 0, maxY));
  };
  const onPointerUp = () => {
    dragInfo.current.dragging = false;
    window.removeEventListener("pointermove", onPointerMove);
    // persist position (no snap-back)
  };

  /* -------------------- Auto-scroll transcript to end ------------------ */
  useEffect(() => {
    const el = transcriptBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [segments, liveLine]);

  /* ----------------- Audio bars: ensure analyser + animate ------------- */
  const ensureAnalyser = () => {
    try {
      const el = audioPlayerRef.current;
      if (!el) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (!audioSourceRef.current) {
        audioSourceRef.current = audioContextRef.current.createMediaElementSource(el);
      }
      if (!analyserRef.current) {
        const an = audioContextRef.current.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.78;
        audioSourceRef.current.connect(an);
        an.connect(audioContextRef.current.destination);
        analyserRef.current = an;
      }
      if (!freqDataRef.current) {
        freqDataRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
      }
      if (!animRafRef.current) {
        startBarsAnimation();
      }
    } catch {}
  };

  const startBarsAnimation = () => {
    const step = () => {
      const analyser = analyserRef.current;
      if (!analyser) { animRafRef.current = requestAnimationFrame(step); return; }
      const data = freqDataRef.current;
      analyser.getByteFrequencyData(data);

      const binsPerBar = Math.max(1, Math.floor(data.length / BAR_COUNT));
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        const start = i * binsPerBar;
        const end = Math.min(data.length, start + binsPerBar);
        for (let j = start; j < end; j++) sum += data[j];
        const avg = sum / (end - start || 1);
        const h = Math.max(0.12, Math.min(1, (avg / 255) ** 0.8));
        const el = barElsRef.current[i];
        if (el) el.style.transform = `scaleY(${h})`;
      }
      animRafRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(animRafRef.current);
    animRafRef.current = requestAnimationFrame(step);
  };

  /* ------------------------------ WebRTC ------------------------------ */
  const startWebRTC = async () => {
    if (pcRef.current || connectionStatus === "connecting") return;
    setConnectionStatus("connecting");
    setIsMicActive(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;

      const { setAudioScale } = useAudioForVisualizerStore.getState();
      startVolumeMonitoring(stream, setAudioScale);
      stream.getAudioTracks().forEach((t) => (t.enabled = true));

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
      });
      pcRef.current = pc;

      pc.addTransceiver("audio", { direction: "sendrecv" });
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        const [rs] = event.streams || [];
        if (!rs) return;
        const el = audioPlayerRef.current;
        if (el) {
          el.srcObject = rs;
          el.play().then(() => ensureAnalyser()).catch((e) => console.warn("Audio play failed:", e));
        }
        setAudioUrl(rs);
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
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

      const dc = pc.createDataChannel("response", { ordered: true });
      dcRef.current = dc;

      // --- STREAMING: reliable transcript rendering (delta + done) ---
      const ensureResp = (id) => {
        const key = id || "default";
        const m = responseMapRef.current;
        if (!m.has(key)) m.set(key, { textBuf: "", audioBuf: "" });
        return m.get(key);
      };

      dc.onopen = () => {
        setConnectionStatus("connected");
        setIsMicActive(true);
        setSegments([]);
        setLiveLine("");
        responseMapRef.current.clear();

        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: "Du bist ein geduldiger Deutschlehrer. Sprich nur Deutsch.",
            turn_detection: { type: "server_vad", threshold: 0.65, prefix_padding_ms: 700, silence_duration_ms: 1500 },
          },
        }));
        dc.send(JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"] },
        }));
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

      dc.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          const t = msg?.type;

          // TEXT stream (delta)
          if ((t === "response.text.delta" || t === "response.output_text.delta") && typeof msg.delta === "string") {
            const r = ensureResp(msg.response_id);
            r.textBuf += msg.delta;
            setLiveLine(r.textBuf.trim());
            return;
          }

          // TEXT done → commit
          if (t === "response.text.done" || t === "response.completed" || t === "response.done") {
            const r = ensureResp(msg.response_id);
            const text = (r.textBuf || "").trim();
            if (text) setSegments((prev) => [...prev, { id: msg.response_id || `${Date.now()}`, text, final: true }]);
            setLiveLine("");
            if (msg.response_id) responseMapRef.current.delete(msg.response_id);
            return;
          }

          // AUDIO transcript (if your server sends it)
          if (t === "response.audio_transcript.delta" && typeof msg.delta === "string") {
            const r = ensureResp(msg.response_id);
            r.audioBuf += msg.delta;
            setLiveLine((r.audioBuf || "").trim());
            return;
          }
          if (t === "response.audio_transcript.done") {
            const r = ensureResp(msg.response_id);
            const spoken = (r.audioBuf || "").trim();
            if (spoken) setSegments((prev) => [...prev, { id: msg.response_id || `${Date.now()}`, text: spoken, final: true }]);
            setLiveLine("");
            if (msg.response_id) responseMapRef.current.delete(msg.response_id);
            return;
          }

          // AUDIO bytes for playback (data-channel path)
          if (t === "response.audio.delta" && msg.delta) {
            const chunk = Uint8Array.from(atob(msg.delta), (c) => c.charCodeAt(0));
            if (!ensureResp("pcm").pcm) ensureResp("pcm").pcm = new Uint8Array(0);
            const cur = ensureResp("pcm").pcm;
            const next = new Uint8Array(cur.length + chunk.length);
            next.set(cur, 0); next.set(chunk, cur.length);
            ensureResp("pcm").pcm = next;
            return;
          }
          if (t === "response.audio.done") {
            const rec = ensureResp("pcm");
            const pcm = rec?.pcm || new Uint8Array(0);
            const wav = encodeWAV(pcm.buffer, 24000, 1);
            const blob = new Blob([wav], { type: "audio/wav" });
            const url = URL.createObjectURL(blob);
            const el = audioPlayerRef.current;
            if (el) {
              el.src = url;
              el.volume = 1;
              el.muted = false;
              ensureAnalyser();
              el.play().catch((err) => console.error("play error:", err.name, err.message));
            }
            responseMapRef.current.delete("pcm");
            return;
          }

          if (t === "output_audio_buffer.stopped") {
            stopAudio();
            return;
          }
        } catch {
          // ignore non-JSON frames
        }
      };

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      const sdp = pc.localDescription?.sdp || offer.sdp;

      const res = await fetch(SIGNAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: sdp,
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
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next));
    }
  };

  /* ------------------------------- Render ------------------------------- */
  return (
    <div className="voice-assistant-wrapper">
      {/* Hidden audio element for remote audio */}
      <audio ref={audioPlayerRef} playsInline style={{ display: "none" }} controls={false} autoPlay />

      {/* ORB */}
      <div className="voice-stage-orb">
        <BaseOrb />
      </div>

      {/* LIVE GERMAN TRANSCRIPT with draggable, persistent cover */}
      <section className="transcript-panel" aria-live="polite" aria-atomic="false" ref={panelRef}>
        <div className="transcript-header">
          <span>AI Transcript</span>
          <span className="lang-pill">Deutsch</span>
        </div>

        {/* TEXT body */}
        <div className="transcript-body" ref={transcriptBodyRef}>
          {segments.length === 0 && !liveLine ? (
            <p className="transcript-seg placeholder">
              Noch keine Transkription. Drücken Sie die Mikrofon-Taste, um zu beginnen.
            </p>
          ) : (
            <>
              {segments.map((s) => (
                <p key={s.id} className={`transcript-seg ${s.final ? "final" : ""}`}>{ <ReactMarkdown>{s.text}</ReactMarkdown>}</p>
              ))}
              {liveLine && <p className="transcript-seg"><ReactMarkdown>{liveLine}</ReactMarkdown></p>}
            </>
          )}
        </div>

        {/* AUDIO BARS — **BELOW THE TEXT** (retained) */}
        <div className="audio-bars" aria-hidden="true">
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <span
              key={i}
              className="bar"
              ref={(el) => (barElsRef.current[i] = el)}
            />
          ))}
        </div>

        {/* COVER with centered AudioWave + enhanced glass handle */}
        <div
          className="transcript-cover glass"
          style={{ transform: `translateY(${coverY}px)` }}
          onPointerDown={onPointerDown}
        >
          <div className="cover-handle glass-strong" />
          <div className="cover-visual">
            {/* ✅ Uses the same audio currently playing: show only when AI speaks */}
            <AudioWave
              stream={audioPlayerRef.current?.srcObject ?? null}
              audioUrl={audioPlayerRef.current?.src ?? null}
            />
          </div>
          <div className="cover-label">Audio-Ausgabe · ziehen, um Transkript zu zeigen/verbergen</div>
        </div>
      </section>

      {/* MIC (under transcript) */}
      <div className="mic-controls">
        {connectionStatus === "connecting" && (
          <div className="connection-status">🔄 Connecting…</div>
        )}
        <button
          className={`mic-icon-btn ${isMicActive ? "active" : "inactive"}`}
          onClick={toggleMic}
          disabled={connectionStatus === "connecting"}
          aria-pressed={isMicActive}
          aria-label={isMicActive ? "Mikrofon stummschalten" : "Sprachsitzung starten"}
          title={isMicActive ? "Mic On" : "Mic Off"}
        >
          <FaMicrophoneAlt />
        </button>
      </div>
    </div>
  );
}






