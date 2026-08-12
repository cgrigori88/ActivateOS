"use client";

import { useEffect, useRef } from "react";

/**
 * The landing page's wireframe torus, rebuilt on Canvas 2D.
 *
 * The marketing site draws this with Three.js. Pulling ~600KB of WebGL onto the
 * sign-in gate — the one page every session starts on, often on a cold cache —
 * is a bad trade for a background, so the same form is projected by hand here:
 * a parametric torus, rotated, drawn as rings and spines with additive
 * compositing so overlapping strokes build brightness the way the GL version's
 * layered materials do.
 *
 * Colours and motion match the site: #2563eb under #60a5fa, and a rotation slow
 * enough to read as ambient rather than animated.
 */

const R = 1;        // ring radius
const TUBE = 0.36;  // tube radius
const RINGS = 96;   // segments around the ring
const SPINES = 22;  // segments around the tube

type Pt = { x: number; y: number; z: number };

function project(p: Pt, cx: number, cy: number, scale: number) {
  // Simple perspective: nearer points spread further from centre.
  const depth = 1 / (2.6 - p.z);
  return { x: cx + p.x * scale * depth, y: cy + p.y * scale * depth, d: depth };
}

export function HeroMesh({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (w < 2 || h < 2) return;

      const cx = w * 0.5;
      const cy = h * 0.46;
      const scale = Math.min(w, h) * 0.92;

      // Tilt keeps the hole readable; the slow spin is the only motion.
      const tilt = 1.06;
      const spin = t * 0.32;
      const wobble = Math.sin(t * 0.6) * 0.05;

      const point = (u: number, v: number): Pt => {
        const cu = Math.cos(u), su = Math.sin(u);
        const cv = Math.cos(v), sv = Math.sin(v);
        // Torus, then rotate about Y (spin) and X (tilt).
        let x = (R + TUBE * cv) * cu;
        let y = (R + TUBE * cv) * su;
        let z = TUBE * sv;
        const cs = Math.cos(spin + wobble), ss = Math.sin(spin + wobble);
        [x, y] = [x * cs - y * ss, x * ss + y * cs];
        const ct = Math.cos(tilt), st = Math.sin(tilt);
        [y, z] = [y * ct - z * st, y * st + z * ct];
        return { x, y, z };
      };

      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1;

      // Rings around the tube — the dense direction.
      for (let i = 0; i < RINGS; i++) {
        const u = (i / RINGS) * Math.PI * 2;
        ctx.beginPath();
        let depthSum = 0;
        for (let j = 0; j <= SPINES; j++) {
          const v = (j / SPINES) * Math.PI * 2;
          const q = project(point(u, v), cx, cy, scale);
          depthSum += q.d;
          if (j === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        // Nearer rings read brighter, which is what gives the form its volume.
        const near = depthSum / (SPINES + 1);
        const a = Math.max(0, Math.min(0.5, (near - 0.32) * 1.5));
        ctx.strokeStyle = `rgba(37, 99, 235, ${a * 0.75})`;
        ctx.stroke();
      }

      // Spines running the long way, fewer and lighter.
      for (let j = 0; j < SPINES; j++) {
        const v = (j / SPINES) * Math.PI * 2;
        ctx.beginPath();
        for (let i = 0; i <= RINGS; i++) {
          const u = (i / RINGS) * Math.PI * 2;
          const q = project(point(u, v), cx, cy, scale);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        ctx.strokeStyle = "rgba(96, 165, 250, 0.10)";
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
    };

    const loop = () => {
      t += 0.0025;
      draw();
      raf = requestAnimationFrame(loop);
    };

    resize();
    draw();
    if (!reduced) raf = requestAnimationFrame(loop);

    const onResize = () => {
      resize();
      draw();
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
