import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "PursuitOS",
  description: "The AI decision and orchestration layer for partner-led revenue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
