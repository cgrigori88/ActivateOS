import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Instrument_Sans, Playfair_Display } from "next/font/google";
import { Shell } from "@/components/shell";

/**
 * The brand typeface is loaded for the wordmark only (docs/DESIGN.md §6).
 * Interface and body type stay on the system stack defined in globals.css.
 */
const brand = Instrument_Sans({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-brand",
});

/** Display serif for the landing page's emphasis words (docs/DESIGN.md §7). */
const display = Playfair_Display({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["400"],
  display: "swap",
  variable: "--font-display-serif",
});

export const metadata: Metadata = {
  title: "PursuitOS",
  description: "The AI decision and orchestration layer for partner-led revenue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${brand.variable} ${display.variable}`}>
      <body className="min-h-screen font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
