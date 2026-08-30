import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/shell";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { currentRole } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
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
  description: "PursuitOS closes the partner-context gap: consented context, joint execution, and settled revenue between companies.",
};

/* Applies a remembered dark choice BEFORE first paint — the shell's toggle owns
   the state afterwards; this only prevents the light flash. Key must match
   THEME_KEY in components/shell.tsx. */
const THEME_BOOT = `try{if(localStorage.getItem("pursuitos:theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // CSP nonce (#65): minted per-request by the middleware; without it the
  // browser would refuse the theme-boot script and dark mode would flash.
  let nonce: string | undefined;
  try {
    nonce = (await headers()).get("x-nonce") ?? undefined;
  } catch {
    /* static build pass — no request, no CSP either */
  }

  // Who is signed in (identity mode only) — the rail's user chip + sign-out.
  let user: string | null = null;
  if (authConfigured()) {
    try {
      const supabase = await supabaseServer();
      user = (await supabase.auth.getUser()).data.user?.email ?? null;
    } catch {
      /* no request cookies (build) — chip falls back to Operator */
    }
  }
  // Rail state — owner nav + attention badges, scoped to the caller's tenant.
  // RISK-1: role + all badge reads run in one withTenant (pins app.org_id).
  // Defaults survive a build pass / no-tenant / db hiccup so the shell always
  // renders. isOwner defaults to Basic-Auth-owns-the-demo only when identity
  // is off; under identity a membership-less user stays non-owner.
  let isOwner = !authConfigured();
  const badges: Record<string, number> = {};
  const alerts: Record<string, number> = {};
  let guest = false;
  try {
    await withTenant(async (db, orgId) => {
      isOwner = (await currentRole(db)) === "owner";
      const { rows: kindRows } = await db.query<{ kind: string }>(
        `select kind from organizations where id = $1`,
        [orgId],
      );
      guest = kindRows[0]?.kind === "guest";
      const { rows } = await db.query<{ pending_lists: string; pending_review: string; incoming_offers: string; pending_pursuits: string; pending_intros: string }>(
        `select
           (select count(*) from account_populations where status = 'pending' and org_id = $1) as pending_lists,
           (select count(*) from review_queue where status = 'pending' and org_id = $1) as pending_review,
           (select count(*) from joint_pursuits jp
            join partnerships p on p.id = jp.partnership_id
            where jp.status = 'proposed' and jp.proposed_by_org <> $1
              and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)) as pending_pursuits,
           (select count(*) from warm_intro_requests w
            join partnerships p on p.id = w.partnership_id
            where w.status = 'requested' and w.requested_by_org <> $1
              and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)) as pending_intros,
           (select count(*) from list_grants g
            join partnerships p on p.id = g.partnership_id
            where g.status = 'offered' and g.from_org_id <> $1
              and (p.initiator_org_id = $1 or p.counterpart_org_id = $1))
           +
           (select count(*) from overlap_probes op
            join partnerships p on p.id = op.partnership_id
            where op.status = 'requested' and op.requested_by_org <> $1
              and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)) as incoming_offers`,
        [orgId],
      );
      if (Number(rows[0].pending_lists) > 0) badges["/mapping"] = Number(rows[0].pending_lists);
      if (Number(rows[0].pending_review) > 0) badges["/review"] = Number(rows[0].pending_review);
      // Cross-tenant shares waiting on the owner's accept/decline live in /admin.
      if (Number(rows[0].incoming_offers) > 0) badges["/admin"] = Number(rows[0].incoming_offers);
      // Partner-side decisions waiting on this org — proposed pursuits plus
      // warm-intro asks (B+3) — pool on the Partners rail item.
      const partnerWaiting = Number(rows[0].pending_pursuits) + Number(rows[0].pending_intros);
      if (partnerWaiting > 0) badges["/partners"] = partnerWaiting;

      // Routines whose LATEST run failed — red, not blue: something broke,
      // it isn't waiting on a decision (task #77).
      const { rows: failed } = await db.query<{ n: string }>(
        `select count(*)::text as n from (
           select distinct on (r.id) rr.status
           from routines r join routine_runs rr on rr.routine_id = r.id
           where r.org_id = $1 and r.enabled
           order by r.id, rr.ran_at desc
         ) x where x.status = 'failed'`,
        [orgId],
      );
      if (Number(failed[0]?.n ?? 0) > 0) alerts["/routines"] = Number(failed[0].n);
    });
  } catch {
    /* build pass, no tenant, or db unavailable — defaults, shell still renders */
  }

  return (
    // suppressHydrationWarning: the boot script may add `class="dark"` before
    // React hydrates, so the html attributes legitimately differ from the SSR.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-screen font-sans">
        <Shell user={user} signOut={signOutAction} isOwner={isOwner} badges={badges} alerts={alerts} guest={guest} pursuitExperience={pursuitExperienceEnabled()}>{children}</Shell>
      </body>
    </html>
  );
}
