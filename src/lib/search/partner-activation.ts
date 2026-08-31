import type { ResolveContext, IntentResult } from "./registry";
import { getObservedActivationPattern, getPartnerActivationProfile } from "@/lib/partners/intelligence";

/**
 * "Where does <partner> activate well?" (P2C-1 §6, Partner/seller class).
 *
 * Answered from the OBSERVED activation pattern the Partner room already renders — presence,
 * selection and terminal outcomes per category, each cell carrying its own sufficiency flag. The
 * distinction that makes this answer honest is preserved verbatim: a cell with too few terminal
 * outcomes is reported as OBSERVED ACTIVITY, never as performance. "Activates well" is a claim
 * about outcomes; where the sample cannot support it, the answer says what was seen instead of
 * ranking on a number it does not have.
 */

/** Deterministic parse: an activation question naming a partner. */
export function parsePartnerActivation(q: string): { partner: string } | null {
  if (!/\bactivat\w*\b|\bexecut\w+\s+well\b|\bstrong(?:est)?\s+(?:with|for|in)\b/i.test(q)) return null;
  if (!/\bwhere\b|\bwhich\b|\bwhat\b|\bhow\b/i.test(q)) return null;
  const m = q.match(/\b(?:does|do|is|are)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)?)\b/)
    ?? q.match(/\b([A-Z][\w&.-]{1,20})(?:'s)?\s+(?:activat|execut|perform)/);
  const partner = m?.[1]?.trim();
  if (!partner || /^(Where|Which|What|How|The|Our|My)$/i.test(partner)) return null;
  return { partner };
}

export async function resolvePartnerActivation(ctx: ResolveContext, partnerName: string): Promise<IntentResult> {
  const { rows } = await ctx.db.query<{ id: string; name: string }>(
    `select id, name from partners where org_id = $1 and name ilike $2 order by length(name) limit 2`,
    [ctx.orgId, `%${partnerName}%`]);
  if (rows.length === 0) {
    return { note: `No partner named "${partnerName}" is on this record.` };
  }
  if (rows.length > 1 && rows[0].name.toLowerCase() !== partnerName.toLowerCase()) {
    return { note: `"${partnerName}" matches ${rows.map((r) => r.name).join(" and ")} — name the one you mean.` };
  }
  const partner = rows[0];

  const pattern = await getObservedActivationPattern(ctx.db, ctx.orgId, partner.id);
  const profile = await getPartnerActivationProfile(ctx.db, ctx.orgId, partner.id, { companyIds: ctx.companyIds });

  if (pattern.status === "UNKNOWN" || pattern.rows.length === 0) {
    return {
      explanation: {
        title: `Where ${partner.name} activates`,
        subtitle: "UNKNOWN — no activation evidence on record. Absence of evidence is not weak performance.",
        lines: profile ? [
          { label: "Presence", value: `${profile.presence.overlapAccounts} overlapping account(s), ${profile.presence.claimedAccounts} claimed` },
          { label: "Activation", value: `selected on ${profile.activation.selectedIn} live pursuit(s)` },
        ] : [],
        grounding: ["pursuits (selected/candidate partner)", "pursuit_outcomes (terminal, canonical)", "partner_accounts · population_members"],
      },
    };
  }

  // Rank only where the sample supports a performance claim; report everything else as activity.
  const proven = pattern.rows.filter((r) => r.sufficient && r.outcomes.won > 0)
    .sort((a, b) => b.outcomes.won / Math.max(1, b.outcomes.sample) - a.outcomes.won / Math.max(1, a.outcomes.sample));
  const observed = pattern.rows.filter((r) => !proven.includes(r) && (r.selected > 0 || r.candidate > 0))
    .sort((a, b) => b.selected - a.selected || b.candidate - a.candidate);

  const lines: { label: string; value: string }[] = [];
  for (const r of proven.slice(0, 4)) {
    lines.push({
      // The same category appears once per relationship state; without the state in the label,
      // three genuinely different cells render as three identical rows with different numbers.
      label: `Activates well — ${r.category} (${r.relationshipState.replace(/_/g, " ").toLowerCase()})`,
      value: `${r.outcomes.won} won of ${r.outcomes.sample} terminal outcome(s)`,
    });
  }
  for (const r of observed.slice(0, 4)) {
    lines.push({
      label: `Observed only — ${r.category} (${r.relationshipState.replace(/_/g, " ").toLowerCase()})`,
      value: `selected ${r.selected}× · candidate ${r.candidate}× · ${r.outcomes.sample === 0 ? "no terminal outcome yet" : `${r.outcomes.sample} outcome(s), below the calibration floor`}`,
    });
  }
  if (profile && profile.activation.medianAcceptDays != null) {
    lines.push({ label: "Responsiveness", value: `median ${profile.activation.medianAcceptDays}d to accept (${profile.activation.acceptSample} pair(s))` });
  }

  return {
    explanation: {
      title: `Where ${partner.name} activates`,
      subtitle: proven.length > 0
        ? `${proven.length} categor${proven.length === 1 ? "y has" : "ies have"} enough terminal outcomes to support a performance claim; the rest is activity, not performance.`
        : "No category yet has enough terminal outcomes to claim performance — what follows is observed activity.",
      lines,
      grounding: [`${pattern.evidencePursuits} pursuit(s) of evidence`, "pursuit_outcomes (terminal, canonical)", "pursuit_route_snapshots", "partner_relationships"],
    },
    hits: [...proven, ...observed].slice(0, 6).map((r) => ({
      group: r.sufficient ? "Proven category" : "Observed category",
      label: `${r.category} · ${r.relationshipState.replace(/_/g, " ").toLowerCase()}`,
      sub: r.sufficient ? `${r.outcomes.won}W/${r.outcomes.lost}L of ${r.outcomes.sample}` : `${r.selected} selected · sample too small to rank`,
      href: `/partners/${partner.id}`,
    })),
  };
}
