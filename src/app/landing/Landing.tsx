"use client";

import { useEffect, useState } from "react";
import { Navbar, Hero, About, NumbersSpeak } from "./Sections1";
import { SmarterBanking, Performance, ExpenseGrid } from "./Sections2";
import { Testimonials, FAQ, FooterCTA } from "./Sections3";
import { MagneticCursor } from "./MagneticCursor";
import { useLenis } from "./useLenis";

/**
 * Client root for the marketing page. The source's TanStack `index.tsx` route
 * becomes this component; `page.tsx` keeps the metadata as a server component.
 */
export function Landing() {
  useLenis();
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main id="top" className="cirform bg-white">
      {mounted && <MagneticCursor />}
      <Navbar scrolled={scrolled} />
      <Hero scrolled={scrolled} />
      <About />
      <NumbersSpeak />
      <SmarterBanking />
      <Performance />
      <ExpenseGrid />
      <Testimonials />
      <FAQ />
      <FooterCTA />
    </main>
  );
}
