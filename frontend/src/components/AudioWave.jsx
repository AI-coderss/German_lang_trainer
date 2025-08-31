/* eslint-disable react-hooks/exhaustive-deps */
// src/components/AudioWave.jsx  (refactored: appears ONLY while AI speaks, with hangover)
import React, { useEffect, useRef, useState } from "react";
import "../styles/AudioWave.css";

const HANGOVER_MS = 900;  // keep visible briefly after speech stops
const ENERGY_THRESH = 0.08; // speaking threshold (0..1 avg magnitude)
const MIN_VISIBLE_MS = 200; // avoid flicker on very short bursts

const AudioWave = ({ stream, audioUrl, onEnded }) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const mediaElRef = useRef(null);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const lastAboveRef = useRef(0);
  const firstVisibleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const fit = () => {
      const w = canvas.parentElement?.clientWidth || 600;
      canvas.width = w;
      canvas.height = Math.max(160, Math.min(300, Math.floor(w * 0.35)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const gradient = () => {
      const g = ctx.createLinearGradient(0, 0, canvas.width, 0);
      g.addColorStop(0, "rgba(255, 25, 255, 0.20)");
      g.addColorStop(0.5, "rgba(25, 255, 255, 0.75)");
      g.addColorStop(1, "rgba(255, 255, 25, 0.20)");
      return g;
    };

    const draw = (dataArray) => {
      const turbulenceFactor = 0.25;
      const numberOfWaves = 10;
      const maxAmplitude = canvas.height / 3.5;
      const baseLine = canvas.height / 2;
      let globalTime = 0;

      const render = () => {
        if (!analyserRef.current) {
          animationRef.current = requestAnimationFrame(render);
          return;
        }
        const analyser = analyserRef.current;
        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);

        // --- speaking detection ---
        let sum = 0;
        for (let i = 0; i < bins.length; i++) sum += bins[i];
        const avg = sum / (255 * bins.length || 1); // 0..1
        const now = performance.now();
        const above = avg >= ENERGY_THRESH;

        if (above) {
          lastAboveRef.current = now;
          if (!isSpeaking) {
            if (!firstVisibleRef.current) firstVisibleRef.current = now;
            if (now - firstVisibleRef.current >= MIN_VISIBLE_MS) setIsSpeaking(true);
          }
        } else {
          if (isSpeaking && now - lastAboveRef.current > HANGOVER_MS) {
            setIsSpeaking(false);
            firstVisibleRef.current = 0;
          }
        }

        // ---- waveform drawing ----
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        globalTime += 0.05;

        const g = gradient();
        for (let j = 0; j < numberOfWaves; j++) {
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = g;

          let x = 0;
          const sliceWidth = canvas.width / bins.length;
          let lastX = 0;
          let lastY = baseLine;

          for (let i = 0; i < bins.length; i++) {
            const v = bins[i] / 128.0;
            const mid = bins.length / 2;
            const distanceFromMid = Math.abs(i - mid) / mid;
            const damp = 1 - Math.pow((2 * i) / bins.length - 1, 2);
            const amp = maxAmplitude * damp * (1 - distanceFromMid);
            const isInv = j % 2 ? 1 : -1;
            const frequency = isInv * (0.05 + turbulenceFactor);
            const y = baseLine + Math.sin(i * frequency + globalTime + j) * amp * v;

            if (i === 0) ctx.moveTo(x, y);
            else {
              const xc = (x + lastX) / 2;
              const yc = (y + lastY) / 2;
              ctx.quadraticCurveTo(lastX, lastY, xc, yc);
            }
            lastX = x;
            lastY = y;
            x += sliceWidth;
          }
          ctx.lineTo(canvas.width, lastY);
          ctx.stroke();
        }

        animationRef.current = requestAnimationFrame(render);
      };
      animationRef.current = requestAnimationFrame(render);
    };

    // --- setup audio graph ---
    const setupContext = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (!analyserRef.current) {
        const an = audioContextRef.current.createAnalyser();
        an.fftSize = 256;
        analyserRef.current = an;
      }
    };

    const fromStream = (ms) => {
      setupContext();
      if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
      const source = audioContextRef.current.createMediaStreamSource(ms);
      source.connect(analyserRef.current);
      sourceNodeRef.current = source;
      setIsSpeaking(false);
      draw();
    };

    const fromUrl = async (url) => {
      // Use a private audio element to detect play state
      const el = new Audio(url);
      el.crossOrigin = "anonymous";
      mediaElRef.current = el;

      await el.play().catch(() => {}); // may require user gesture; still attach to analyser
      setupContext();

      if (sourceNodeRef.current) sourceNodeRef.current.disconnect();
      const src = audioContextRef.current.createMediaElementSource(el);
      src.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
      sourceNodeRef.current = src;

      const onPlay = () => { firstVisibleRef.current = 0; setIsSpeaking(false); };
      const onEnded = () => {
        setTimeout(() => setIsSpeaking(false), HANGOVER_MS);
      };
      el.addEventListener("play", onPlay);
      el.addEventListener("ended", onEnded);

      draw();
    };

    if (stream) fromStream(stream);
    else if (audioUrl) fromUrl(audioUrl);

    return () => {
      cancelAnimationFrame(animationRef.current);
      if (mediaElRef.current) {
        mediaElRef.current.pause();
        mediaElRef.current.src = "";
      }
      try { sourceNodeRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect?.(); } catch {}
      // we do NOT close the AudioContext to allow reuse across plays
      ro.disconnect();
    };
  }, [stream, audioUrl]);

  return (
    <div
      ref={wrapRef}
      className={`container-audio-wave ${isSpeaking ? "is-speaking" : "wave-hidden"}`}
      aria-hidden={!isSpeaking}
    >
      <canvas ref={canvasRef} id="waveCanvas" />
    </div>
  );
};

export default AudioWave;
