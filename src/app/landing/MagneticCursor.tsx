"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export function MagneticCursor() {
  const dotX = useMotionValue(-100);
  const dotY = useMotionValue(-100);
  const ringXRaw = useMotionValue(-100);
  const ringYRaw = useMotionValue(-100);
  const ringX = useSpring(ringXRaw, { stiffness: 180, damping: 22, mass: 0.6 });
  const ringY = useSpring(ringYRaw, { stiffness: 180, damping: 22, mass: 0.6 });
  const ringScale = useSpring(1, { stiffness: 300, damping: 25 });
  const ringOpacity = useSpring(0, { stiffness: 300, damping: 30 });
  const dotOpacity = useSpring(0, { stiffness: 300, damping: 30 });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMove = (e: MouseEvent) => {
      dotX.set(e.clientX - 4);
      dotY.set(e.clientY - 4);
      ringXRaw.set(e.clientX - 22);
      ringYRaw.set(e.clientY - 22);
      ringOpacity.set(1);
      dotOpacity.set(1);
    };

    const onEnterBtn = () => ringScale.set(2.2);
    const onLeaveBtn = () => ringScale.set(1);

    window.addEventListener("mousemove", onMove);

    const attach = () => {
      const btns = document.querySelectorAll("a, button, [data-cursor-grow]");
      btns.forEach((b) => {
        b.addEventListener("mouseenter", onEnterBtn);
        b.addEventListener("mouseleave", onLeaveBtn);
      });
      return btns;
    };

    let btns = attach();
    const observer = new MutationObserver(() => {
      btns.forEach((b) => {
        b.removeEventListener("mouseenter", onEnterBtn);
        b.removeEventListener("mouseleave", onLeaveBtn);
      });
      btns = attach();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      observer.disconnect();
      btns.forEach((b) => {
        b.removeEventListener("mouseenter", onEnterBtn);
        b.removeEventListener("mouseleave", onLeaveBtn);
      });
    };
  }, [dotX, dotY, ringXRaw, ringYRaw, ringOpacity, dotOpacity, ringScale]);

  return (
    <>
      <motion.div
        style={{
          x: dotX,
          y: dotY,
          opacity: dotOpacity,
          position: "fixed",
          top: 0,
          left: 0,
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "#fff",
          pointerEvents: "none",
          zIndex: 9999,
          mixBlendMode: "difference",
        }}
      />
      <motion.div
        style={{
          x: ringX,
          y: ringY,
          scale: ringScale,
          opacity: ringOpacity,
          position: "fixed",
          top: 0,
          left: 0,
          width: 44,
          height: 44,
          borderRadius: 999,
          border: "1.5px solid rgba(255,255,255,0.85)",
          pointerEvents: "none",
          zIndex: 9999,
          mixBlendMode: "difference",
        }}
      />
    </>
  );
}
