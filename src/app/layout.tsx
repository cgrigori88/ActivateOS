import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Instrument_Sans, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Shell } from "@/components/shell";

/**
 * Interface typeface (docs/BRAND.md §4). Plus Jakarta Sans is a humanist
 * geometric with open counters that holds up at 13px in a dense table, which is
 * where this product lives.
 *
 * To revert to the system stack, drop `--font-ui` from `--font-sans` in
 * globals.css — one line, no other change needed.
 */
const ui = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ui",
});

/** Identifiers, timestamps, confidences — anything read character by character. */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono-ui",
});

/** The wordmark only (docs/BRAND.md §2). */
const brand = Instrument_Sans({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-brand",
});

export const metadata: Metadata = {
  title: "PursuitOS",
  description: "The AI decision and orchestration layer for partner-led revenue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable} ${brand.variable}`}>
      <body className="min-h-screen font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
