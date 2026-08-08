import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "ActivateOS",
  description: "The AI decision and orchestration layer for partner-led revenue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <nav
          style={{
            display: "flex",
            gap: "1.25rem",
            padding: "0.75rem 1.5rem",
            borderBottom: "1px solid #eee",
            fontSize: "0.95rem",
          }}
        >
          <strong>ActivateOS</strong>
          <Link href="/">Accounts</Link>
          <Link href="/motions">Motions</Link>
          <Link href="/review">Review</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
