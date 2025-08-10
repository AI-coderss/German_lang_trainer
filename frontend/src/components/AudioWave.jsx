import React, { useEffect, useRef } from 'react';
import '../styles/AudioWave.css';

const AudioWave = ({ stream, audioUrl, onEnded }) => {
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameIdRef = useRef(null);
  const resizeObserverRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });

    // --- sizing helpers (CSS pixel perfect + DPR) ---
    const setCanvasSize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      // use actual rendered size from CSS
      const cssW = Math.floor(canvas.clientWidth || 600);
      const cssH = Math.floor(canvas.clientHeight || 180);
      canvas.width  = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      // draw in CSS pixel coordinates
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    setCanvasSize();
    // Track container size changes
    resizeObserverRef.current = new ResizeObserver(() => {
      cancelAnimationFrame(animationFrameIdRef.current);
      setCanvasSize();
      // restart animation loop on resize to avoid stretching artifacts
      animationFrameIdRef.current = requestAnimationFrame(animate);
    });
    resizeObserverRef.current.observe(canvas);

    // --- drawing parameters ---
    const turbulenceFactor = 0.25;
    let globalTime = 0;

    const makeGradient = () => {
      const g = ctx.createLinearGradient(0, 0, canvas.clientWidth, 0);
      g.addColorStop(0,   'rgba(255, 25, 255, 0.2)');
      g.addColorStop(0.5, 'rgba(25, 255, 255, 0.75)');
      g.addColorStop(1,   'rgba(255, 255, 25, 0.2)');
      return g;
    };
    let strokeGradient = makeGradient();

    const drawWave = (dataArray) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const baseLine = h / 2;
      const numberOfWaves = 10;
      const maxAmplitude = h / 3.5;

      ctx.clearRect(0, 0, w, h);
      globalTime += 0.05;

      // We’re using TIME DOMAIN, so the signal is centered by design.
      // Smooth bezier for nice fluid curves.
      for (let j = 0; j < numberOfWaves; j++) {
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = strokeGradient;

        let x = 0;
        const sliceWidth = w / (dataArray.length - 1);
        let lastX = 0;
        let lastY = baseLine;

        for (let i = 0; i < dataArray.length; i++) {
          // normalize around baseline (128)
          const v = (dataArray[i] - 128) / 128;            // -1..1 roughly
          // bell-shaped damping toward edges
          const damp = 1 - Math.pow((2 * i) / dataArray.length - 1, 2); // 0..1..0
          const isWaveInverted = (j % 2 ? 1 : -1);
          const frequency = isWaveInverted * (0.05 + turbulenceFactor);
          const amplitude = maxAmplitude * damp;
          const y = baseLine + Math.sin(i * frequency + globalTime + j) * amplitude * v;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            // smooth out with quadratic curves
            const xc = (x + lastX) / 2;
            const yc = (y + lastY) / 2;
            ctx.quadraticCurveTo(lastX, lastY, xc, yc);
          }
          lastX = x;
          lastY = y;
          x += sliceWidth;
        }

        ctx.lineTo(w, lastY);
        ctx.stroke();
      }
    };

    const animate = () => {
      const analyser = analyserRef.current;
      if (!analyser) {
        animationFrameIdRef.current = requestAnimationFrame(animate);
        return;
      }
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      // Use TIME DOMAIN so the wave is balanced around center horizontally
      analyser.getByteTimeDomainData(dataArray);
      drawWave(dataArray);
      animationFrameIdRef.current = requestAnimationFrame(animate);
    };

    // --- audio setups ---
    const setupFromStream = (mediaStream) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      animationFrameIdRef.current = requestAnimationFrame(animate);
    };

    const setupFromAudio = (url) => {
      const audio = new Audio(url);
      audio.crossOrigin = 'anonymous';
      audio.play().catch(() => {});

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      animationFrameIdRef.current = requestAnimationFrame(animate);

      audio.addEventListener('ended', () => {
        onEnded?.();
        cancelAnimationFrame(animationFrameIdRef.current);
        if (audioContext.state !== 'closed') audioContext.close();
      });
    };

    // kick off with whichever is available
    if (stream) setupFromStream(stream);
    else if (audioUrl) setupFromAudio(audioUrl);

    // Recompute gradient on resize
    const onResize = () => { strokeGradient = makeGradient(); };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserverRef.current?.disconnect();
      cancelAnimationFrame(animationFrameIdRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [stream, audioUrl, onEnded]);

  return (
    <div className="container-audio-wave">
      <canvas ref={canvasRef} id="waveCanvas" />
    </div>
  );
};

export default AudioWave;
