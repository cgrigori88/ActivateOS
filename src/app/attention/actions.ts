"use server";

import { redirect } from "next/navigation";
import { withTenant } from "@/lib/db/tenant";
import { currentRole } from "@/lib/auth/org";
import { supabaseServer } from "@/lib/auth/supabase";
import { readAttentionToken } from "@/lib/pursuits/evidence/attention-token";
import { recordAttentionSelection } from "@/lib/pursuits/evidence/attention-capture";

/**
 * SELECTING WORK FROM A RANKED SURFACE — the one place attention evidence is written.
 *
 * ── WHY A SERVER ACTION AND NOT A LINK ──────────────────────────────────────────────────────────
 *
 * Every ranked card used to navigate by a plain `<Link>`, which is a GET. A GET happens on prefetch,
 * on back/forward, on a bot, and on a deep link someone pasted into chat — so it cannot carry the
 * meaning "this person deliberately chose to work this pursuit". The primary CTA is now a form
 * submission: an explicit, non-idempotent act that only a person clicking the button performs.
 * Ordinary navigation into the pursuit remains available and still writes nothing.
 *
 * ── THE TOKEN IS EVIDENCE CONTEXT, NOT AUTHORITY ────────────────────────────────────────────────
 *
 * Identity and membership are resolved here, independently, from the session — and only then
 * checked AGAINST the token. The token cannot name its own user or organization into existence; it
 * can only fail to match the ones the server already established. It grants nothing: everything it
 * describes, the caller was already authorized to see in order to have been shown it.
 *
 * ── WHAT IS PERSISTED IS WHAT WAS RENDERED ──────────────────────────────────────────────────────
 *
 * P2 is NOT recomputed. The point of the observation is the state the user actually saw, and by the
 * time they click, the live ranking may legitimately have moved. Substituting the current rank
 * would record something nobody looked at.
 *
 * The redirect happens whatever the evidence outcome. A person clicking "Open" must reach the
 * pursuit; failing to record an observation is an evidence problem, not a reason to strand them.
 */
export async function selectPursuitAction(formData: FormData): Promise<void> {
  const token = String(formData.get("attentionToken") ?? "");
  const href = String(formData.get("href") ?? "");
  // The navigation target is derived from the SUBJECT, never taken from the form, so this action
  // cannot be turned into an open redirect by anyone who can post to it.
  let destination = "/";

  await withTenant(async (db, orgId) => {
    const role = await currentRole(db);
    if (!role) return;                               // no membership, no evidence and no action
    const facts = readAttentionToken(token);
    if (!facts) return;                              // absent, tampered or not minted by this server

    let userId: string | null = null;
    try { userId = (await (await supabaseServer()).auth.getUser()).data.user?.id ?? null; } catch { /* no identity session */ }

    // THREE BINDINGS, ALL CHECKED AGAINST INDEPENDENTLY-ESTABLISHED STATE.
    if (facts.orgId !== orgId) return;                                  // minted for another tenant
    if (facts.userId !== null && userId !== null && facts.userId !== userId) return;  // minted for another person
    const { rows } = await db.query(
      `select 1 from pursuits where id = $1 and org_id = $2`, [facts.pursuitId, orgId]);
    if (!rows[0]) return;                                               // subject is not this org's

    destination = `/pursuits/${facts.pursuitId}`;
    await recordAttentionSelection(db, { facts, userId });
  });

  void href;
  redirect(destination);
}
