"use client";

import { useState, useRef, useEffect } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Mark } from "@/components/brand";
import { Logo } from "./Sections1";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });
  ScrollTrigger.normalizeScroll(false);
}

const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ----------------------------- 8. PRODUCT TRUTHS ----------------------------- */

/**
 * The source section was a customer-testimonial carousel with named people at
 * named banks. PursuitOS has no customers yet — it is taking its first design
 * partners — so publishing quotes here would be inventing endorsements. The
 * carousel, marquee and per-letter weight animation are kept exactly; the cards
 * carry the three product truths from docs/DESIGN.md §1 instead. Swap in real
 * quotes once a design partner has given permission.
 */
const truths = [
  {
    brand: "Truth 01",
    quote:
      "Every number explains itself. Any score, band or recommendation opens into its feature contributions and cited evidence in one click.",
    name: "Explainability",
    role: "docs/DESIGN.md §1",
  },
  {
    brand: "Truth 02",
    quote:
      "Approval is the workflow, not a feature. Drafts flow through queues built like a great code-review tool — fast, keyboard-driven, never showing more than the decision needs.",
    name: "Approval",
    role: "docs/DESIGN.md §1",
  },
  {
    brand: "Truth 03",
    quote:
      "Trust is visible. The source-trust ledger, sampling rates and agent decision logs are first-class UI, so operators can see the system earning autonomy.",
    name: "Trust",
    role: "docs/DESIGN.md §1",
  },
];

function WeightLetter({ char }: { char: string }) {
  const [w, setW] = useState(400);
  return (
    <motion.span
      onMouseMove={(e) => {
        if (e.movementX > 0) setW(200);
        else if (e.movementX < 0) setW(700);
      }}
      animate={{ fontWeight: w }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="inline-block cursor-default"
    >
      {char === " " ? " " : char}
    </motion.span>
  );
}

export function Testimonials() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  useEffect(() => {
    if (!inView) return;
    const ctx = gsap.context(() => {
      gsap.from(".testimonial-card", {
        y: 80,
        opacity: 0,
        rotationY: 8,
        duration: 1,
        stagger: 0.12,
        ease: "expo.out",
        transformOrigin: "left center",
        scrollTrigger: {
          trigger: ".testimonials-section",
          start: "top 75%",
          toggleActions: "play none none none",
        },
      });
    });
    return () => ctx.revert();
  }, [inView]);

  return (
    <section
      ref={ref}
      className="testimonials-section relative overflow-hidden bg-testimonials-flow pt-24 pb-12"
    >
      <div className="relative z-10 max-w-[1180px] mx-auto px-6">
        <div className="flex items-end justify-between mb-10">
          <h2 className="text-[clamp(30px,4vw,48px)] leading-[1.1] tracking-tight">
            <span className="font-display block">
              {"Built on three".split("").map((c, i) => (
                <WeightLetter key={`a-${i}`} char={c} />
              ))}
            </span>
            <span className="block">
              {"product truths".split("").map((c, i) => (
                <WeightLetter key={`b-${i}`} char={c} />
              ))}
            </span>
          </h2>
          <span className="chip-dark">How we build</span>
        </div>

        <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
          <motion.div
            animate={{ x: ["0%", "calc(-50% - 8px)"] }}
            transition={{ duration: 26, ease: "linear", repeat: Infinity }}
            className="flex w-max gap-4"
          >
            {[...truths, ...truths].map((t, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -5, boxShadow: "0 25px 65px -30px rgba(0,0,0,.2)" }}
                className="testimonial-card will-change-transform w-[min(360px,calc(100vw-48px))] shrink-0 rounded-2xl border border-ink/10 bg-white p-6 shadow-[0_20px_60px_-30px_rgba(0,0,0,.15)] md:w-[370px]"
              >
                <div className="text-sm text-ink-soft mb-4 flex items-center gap-2">
                  <span className="opacity-45">
                    <Mark size={18} />
                  </span>
                  {t.brand}
                </div>
                <p className="text-[14px] leading-relaxed text-ink">
                  <span className="inline-block w-4 h-4 align-middle mr-1 rounded bg-ink" /> {t.quote}
                </p>
                <div className="mt-5 text-sm">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-ink-soft text-xs">{t.role}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        <div className="mx-auto mt-7 h-1 w-28 overflow-hidden rounded-full bg-ink/15" aria-hidden>
          <motion.div
            className="h-full w-1/3 rounded-full bg-ink"
            animate={{ x: ["-100%", "300%"] }}
            transition={{ duration: 8.67, ease: "linear", repeat: Infinity }}
          />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- 9. FAQ ----------------------------- */

const faqs = [
  {
    q: "What does PursuitOS actually decide?",
    a: "Which combination of account, product, partner and seller to activate right now — with the trigger that makes it urgent, the evidence behind the score, and the message to lead with.",
  },
  {
    q: "How is this different from ecosystem mapping or intent data?",
    a: "Those are inputs. Mapping shows who is connected to whom and intent providers sell signals; PursuitOS sits above both and decides what to do with them, then assembles the motion.",
  },
  {
    q: "How do engagements start?",
    a: "With a 30-Day Partner Activation: one vendor, one product, one partner, one campaign and roughly 100 target accounts, run end to end with 30 days of activation support.",
  },
  {
    q: "Can I see why a score is what it is?",
    a: "Always. Every score opens into its feature contributions and the cited evidence behind them, each claim carrying its source, date and confidence.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });

  useEffect(() => {
    if (!inView) return;
    const ctx = gsap.context(() => {
      gsap.from(".faq-item", {
        clipPath: "inset(0 0 100% 0)",
        opacity: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: "expo.out",
        scrollTrigger: { trigger: ".faq-section", start: "top 70%", toggleActions: "play none none none" },
      });
    });
    return () => ctx.revert();
  }, [inView]);

  return (
    <section id="faq" ref={ref} className="faq-section relative overflow-hidden bg-faq-flow py-24">
      <div className="max-w-[760px] mx-auto px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease: easeOut }}
          className="text-[clamp(30px,4vw,48px)] tracking-tight"
        >
          Have a <span className="font-display">question</span>?
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.15, ease: easeOut }}
          className="text-ink-soft mt-4"
        >
          Clear answers to the most common questions about
          <br />
          the platform, the engagement, and the evidence.
        </motion.p>
        <div className="mt-12 space-y-3 text-left">
          {faqs.map((f, i) => (
            <div
              key={i}
              className="faq-item rounded-full bg-white border border-ink/10 px-6 py-1 shadow-[0_8px_30px_-20px_rgba(0,0,0,.15)]"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between py-3.5 hover:text-brand-deep transition-colors"
              >
                <span className="text-sm font-medium text-inherit">{f.q}</span>
                <motion.span
                  animate={{ rotate: open === i ? 45 : 0 }}
                  transition={{ duration: 0.3, ease: easeOut }}
                  className="text-inherit text-lg"
                >
                  +
                </motion.span>
              </button>
              <AnimatePresence initial={false} mode="wait">
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 24 }}
                    className="overflow-hidden text-sm text-ink-soft"
                  >
                    <div className="pb-4 pr-6">{f.a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- 10. FOOTER CTA ----------------------------- */

export function FooterCTA() {
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".footer-cta-heading", {
        y: 60,
        opacity: 0,
        duration: 1.2,
        ease: "expo.out",
        scrollTrigger: { trigger: ".footer-cta", start: "top 80%", toggleActions: "play none none none" },
      });
      gsap.to(".footer-radial", {
        scale: 1.4,
        ease: "none",
        scrollTrigger: { trigger: ".footer-cta", start: "top bottom", end: "bottom top", scrub: 1.2 },
      });
    });
    return () => ctx.revert();
  }, []);

  return (
    <footer
      id="request"
      className="footer-cta relative text-white overflow-hidden"
      style={{ background: "var(--gradient-footer)" }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-64 bg-footer-transition" />
      <div className="footer-radial absolute -top-40 left-1/2 -translate-x-1/2 w-[1100px] h-[700px] rounded-full bg-[radial-gradient(closest-side,#5a7bff66,transparent_70%)]" />

      <div className="relative z-10 max-w-[1200px] mx-auto px-6 pt-28 pb-10">
        <div className="text-center">
          <h2 className="footer-cta-heading text-[clamp(34px,5vw,56px)] leading-[1.1] tracking-tight font-medium">
            Ready to know where
            <br />
            <span className="font-display">revenue moves next?</span>
          </h2>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mt-8"
          >
            <a href="mailto:hello@pursuitos.io" className="btn-pill">
              Request access
            </a>
          </motion.div>
        </div>

        <div className="mt-32 grid grid-cols-12 gap-8 items-start">
          <div className="col-span-12 md:col-span-4">
            <Logo light />
            <div className="text-sm text-white/60 mt-4 space-y-1">
              <div>hello@pursuitos.io</div>
              <div>The partner revenue graph</div>
            </div>
          </div>
          <div className="col-span-6 md:col-span-3 text-sm space-y-2 text-white/80">
            <div className="flex items-center gap-1">Platform</div>
            <div className="flex items-center gap-1">
              Evidence <span className="opacity-60">▾</span>
            </div>
            <div>Motions</div>
            <div>Docs</div>
          </div>
          <div className="col-span-6 md:col-span-3 text-sm space-y-2 text-white/80">
            <div>FAQ</div>
            <div>Security</div>
          </div>
          <div className="col-span-12 md:col-span-2 flex justify-end">
            <a
              href="#top"
              className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 transition"
            >
              ↑
            </a>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-white/10 flex items-center justify-between text-xs text-white/50">
          <span>© 2026 — PursuitOS. All rights reserved</span>
          <span>Privacy</span>
        </div>
      </div>
    </footer>
  );
}
