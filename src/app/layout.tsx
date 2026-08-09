import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "PursuitOS",
  description: "The AI decision and orchestration layer for partner-led revenue.",
};

const NAV = [
  { href: "/", label: "Today" },
  { href: "/accounts", label: "Accounts" },
  { href: "/motions", label: "Motions" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/queue", label: "Queue" },
  { href: "/review", label: "Review" },
  { href: "/sources", label: "Sources" },
  { href: "/insights", label: "Insights" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        <nav className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Pursuit<span className="text-blue-700 dark:text-blue-400">OS</span>
            </Link>
            <div className="flex gap-4 text-sm text-neutral-600 dark:text-neutral-300">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-black dark:hover:text-white">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
      </body>
    </html>
  );
}
