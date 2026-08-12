import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { currentRole } from "@/lib/auth/org";
import { getPool } from "@/db/client";
import { signOutAction } from "@/app/login/actions";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PursuitOS",
  description: "The AI decision and orchestration layer for partner-led revenue.",
};

/* Applies a remembered dark choice BEFORE first paint — the shell's toggle owns
   the state afterwards; this only prevents the light flash. Key must match
   THEME_KEY in components/shell.tsx. */
const THEME_BOOT = `try{if(localStorage.getItem("pursuitos:theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Who is signed in (identity mode only) — the rail's user chip + sign-out.
  let user: string | null = null;
  let isOwner = true; // Basic-Auth / local-dev mode: the operator owns the demo
  if (authConfigured()) {
    try {
      const supabase = await supabaseServer();
      const { data } = await supabase.auth.getUser();
      user = data.user?.email ?? null;
      if (user) isOwner = (await currentRole(getPool())) === "owner";
    } catch {
      /* no request cookies (build) — chip falls back to Operator */
    }
  }
  return (
    // suppressHydrationWarning: the boot script may add `class="dark"` before
    // React hydrates, so the html attributes legitimately differ from the SSR.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen font-sans">
        <Shell user={user} signOut={signOutAction} isOwner={isOwner}>{children}</Shell>
      </body>
    </html>
  );
}
