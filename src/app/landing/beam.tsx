"use client";

import { useEffect, useRef } from "react";

/**
 * The background field — supplied by us, since the brand kit ships without one.
 * It satisfies the four constraints in the handoff (§02):
 *
 *  1. Ground value is fixed. The field is laid over --pos-canvas at low alpha
 *     and never replaces it.
 *  2. Nothing coloured under copy. Each beam is parked outside the centre
 *     reading column, and every panel carries its own opaque surface.
 *  3. No visible bottom edge. A ~800px scrim resolves the field into the
 *     ground before it ends.
 *  4. Scroll is the only clock. The field translates against page progress at
 *     roughly a fifth of scroll speed and crossfades between three fixed
 *     temperatures. It has no timeline of its own — no autoplay, loop or pulse.
 */

/* Core stop at the beam centre, falloff stop at 32%, dead by 76%. */
const BEAMS = [
  {
    // The argument — hero.
    pos: "72% 8%",
    css: "rgba(126,220,255,0.38) 0%, rgba(29,134,255,0.22) 32%, rgba(29,134,255,0.10) 54%, rgba(29,134,255,0) 76%",
  },
  {
    // The evidence — mid-page.
    pos: "18% 46%",
    css: "rgba(150,140,255,0.32) 0%, rgba(60,44,218,0.22) 32%, rgba(60,44,218,0.10) 54%, rgba(60,44,218,0) 76%",
  },
  {
    // The close — footer.
    pos: "78% 88%",
    css: "rgba(244,203,78,0.24) 0%, rgba(234,157,0,0.15) 32%, rgba(234,157,0,0.08) 54%, rgba(234,157,0,0) 76%",
  },
] as const;

/** Triangular weight: full at `centre`, zero at +/- `span` of page progress. */
function weightAt(p: number, centre: number, span: number): number {
  return Math.max(0, 1 - Math.abs(p - centre) / span);
}

export function Beam() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const p = scrollable > 0 ? Math.min(1, Math.max(0, y / scrollable)) : 0;

      // Translation on page progress only, at ~a fifth of scroll speed.
      el.style.transform = `translate3d(0, ${-y * 0.2}px, 0)`;
      el.style.setProperty("--t1", String(weightAt(p, 0.0, 0.55)));
      el.style.setProperty("--t2", String(weightAt(p, 0.5, 0.45)));
      el.style.setProperty("--t3", String(weightAt(p, 1.0, 0.45)));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        ref={ref}
        className="pos-beam absolute will-change-transform"
        style={{
          // Taller than the viewport so the parallax never exposes an edge.
          inset: "-10% -10% -60% -10%",
          ["--t1" as string]: 1,
          ["--t2" as string]: 0,
          ["--t3" as string]: 0,
        }}
      >
        {BEAMS.map((b, i) => (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              opacity: `var(--t${i + 1})`,
              background: `radial-gradient(58% 42% at ${b.pos}, ${b.css})`,
            }}
          />
        ))}
      </div>

      {/* Scrim: the field resolves into the ground rather than ending on an edge. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[800px]"
        style={{
          background: "linear-gradient(to bottom, rgba(4,13,67,0) 0%, var(--pos-canvas) 100%)",
        }}
      />
    </div>
  );
}
