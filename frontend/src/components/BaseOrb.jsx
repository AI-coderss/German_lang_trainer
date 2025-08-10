/* eslint-disable no-unused-vars */
import React, { useEffect, useRef } from "react";
import "../styles/BaseOrb.css";
import useAudioForVisualizerStore from "../store/useAudioForVisualizerStore";
import { enhanceAudioScale } from "./audioLevelAnalyzer";

/* Turn #hex or rgb/rgba to "r,g,b" */
const toRgbString = (color) => {
  if (!color) return "10,100,255";
  const c = color.trim();
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const r = parseInt(h.slice(0,2), 16);
    const g = parseInt(h.slice(2,4), 16);
    const b = parseInt(h.slice(4,6), 16);
    return `${r},${g},${b}`;
  }
  const m = c.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  return "10,100,255";
};

const BaseOrb = () => {
  const canvasRef = useRef(null);
  const themeRgbRef = useRef("10,100,255");
  const bgRef = useRef("#ffffff");

  const audioScale = useAudioForVisualizerStore((s) => enhanceAudioScale(s.audioScale));

  // Read CSS vars from the canvas element itself (respects cascade + theme)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const computeVars = () => {
      const cs = getComputedStyle(canvas);
      const accent = cs.getPropertyValue("--accent").trim() || "#0a64ff";
      const bg = cs.getPropertyValue("--bg").trim() || "#ffffff";
      themeRgbRef.current = toRgbString(accent); // cyan in dark, blue in light
      bgRef.current = bg;
    };
    computeVars();

    const mo = new MutationObserver(computeVars);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const ro = new ResizeObserver(computeVars);
    ro.observe(canvas);

    return () => { mo.disconnect(); ro.disconnect(); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");

    // Settings
    let sphereRad = 280;
    let radius_sp = audioScale / 2;

    const fLen = 320;
    const projCenterX = canvas.width / 2;
    const projCenterY = canvas.height / 2;
    const zMax = fLen - 2;

    const particleAlpha = 1;
    const randAccelX = 0.1, randAccelY = 0.1, randAccelZ = 0.1;
    const gravity = 0;
    const particleRad = 2.5;
    const zeroAlphaDepth = -750;

    let turnAngle = 0;
    const turnSpeed = (2 * Math.PI) / 1200;

    const particleList = {};
    const recycleBin = {};

    function addParticle(x0, y0, z0, vx0, vy0, vz0) {
      let p = recycleBin.first || {};
      recycleBin.first = p.next || null;

      if (!particleList.first) {
        particleList.first = p; p.prev = p.next = null;
      } else {
        p.next = particleList.first; particleList.first.prev = p;
        particleList.first = p; p.prev = null;
      }

      Object.assign(p, {
        x: x0, y: y0, z: z0,
        velX: vx0, velY: vy0, velZ: vz0,
        age: 0, dead: false, right: Math.random() < 0.5,
        attack: 50, hold: 50, decay: 100,
        initValue: 0, holdValue: particleAlpha, lastValue: 0,
        stuckTime: 90 + Math.random() * 20,
        accelX: 0, accelY: gravity, accelZ: 0,
      });
      return p;
    }

    function recycle(p) {
      if (particleList.first === p) {
        particleList.first = p.next; if (p.next) p.next.prev = null;
      } else {
        if (p.next) p.next.prev = p.prev;
        if (p.prev) p.prev.next = p.next;
      }
      p.next = recycleBin.first; if (recycleBin.first) recycleBin.first.prev = p;
      recycleBin.first = p; p.prev = null;
    }

    let spawnCount = 0;

    const onFrame = () => {
      requestAnimationFrame(onFrame);

      // Live audio scale
      const raw = useAudioForVisualizerStore.getState().audioScale;
      radius_sp = Math.max(0.7, enhanceAudioScale(raw));

      // Spawn a few particles
      if (++spawnCount >= 1) {
        spawnCount = 0;
        for (let i = 0; i < 8; i++) {
          const theta = Math.random() * 2 * Math.PI;
          const phi = Math.acos(Math.random() * 2 - 1);
          const x0 = sphereRad * Math.sin(phi) * Math.cos(theta);
          const y0 = sphereRad * Math.sin(phi) * Math.sin(theta);
          const z0 = sphereRad * Math.cos(phi);
          addParticle(x0, y0, -3 - sphereRad + z0, 0.002 * x0, 0.002 * y0, 0.002 * z0);
        }
      }

      turnAngle = (turnAngle + turnSpeed) % (2 * Math.PI);
      const sinAngle = Math.sin(turnAngle);
      const cosAngle = Math.cos(turnAngle);

      // THEME background (light: white, dark: near-black)
      ctx.fillStyle = bgRef.current;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let p = particleList.first;
      while (p) {
        const next = p.next;
        p.age++;

        if (p.age > p.stuckTime) {
          p.velX += randAccelX * (Math.random() * 2 - 1);
          p.velY += gravity + randAccelY * (Math.random() * 2 - 1);
          p.velZ += randAccelZ * (Math.random() * 2 - 1);
          p.x += p.velX; p.y += p.velY; p.z += p.velZ;
        }

        const rotX = cosAngle * p.x + sinAngle * (p.z + sphereRad + 3);
        const rotZ = -sinAngle * p.x + cosAngle * (p.z + sphereRad + 3) - sphereRad - 3;
        const m = (radius_sp * fLen) / (fLen - rotZ);
        p.projX = rotX * m + projCenterX;
        p.projY = p.y * m + projCenterY;

        if (p.age < p.attack + p.hold + p.decay) {
          if (p.age < p.attack) {
            p.alpha = ((p.holdValue - p.initValue) / p.attack) * p.age + p.initValue;
          } else if (p.age < p.attack + p.hold) {
            p.alpha = p.holdValue;
          } else {
            p.alpha = ((p.lastValue - p.holdValue) / p.decay) * (p.age - p.attack - p.hold) + p.holdValue;
          }
        } else {
          p.dead = true;
        }

        const outOfView =
          p.projX > canvas.width || p.projX < 0 ||
          p.projY > canvas.height || p.projY < 0 || rotZ > zMax;

        if (outOfView || p.dead) {
          recycle(p);
        } else {
          const depthAlpha = Math.min(1, Math.max(0, 1 - rotZ / zeroAlphaDepth));
          // THEME accent (blue in light, cyan in dark)
          ctx.fillStyle = `rgba(${themeRgbRef.current},${depthAlpha * p.alpha})`;
          ctx.beginPath();
          ctx.arc(p.projX, p.projY, m * particleRad, 0, 2 * Math.PI);
          ctx.fill();
        }

        p = next;
      }
    };

    requestAnimationFrame(onFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      className="base-orb"
      id="base-orb"
      ref={canvasRef}
      width={500}
      height={500}
      style={{ backgroundColor: "transparent", width: 600, height: "auto", borderRadius: "50%" }}
    />
  );
};

export default BaseOrb;
