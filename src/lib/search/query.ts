import type { PoolClient } from "pg";
import { opportunityCondition, CONDITION_LABEL, type ConditionState } from "@/lib/opportunities/condition";
import { getMotionFunnels, getMotionConstraints, accountsAtStage } from "@/lib/motions/funnel";

/**
 * Unified ⌘K retrieval (scale-disclosure §5 / R6). THREE explicit intent classes, all deterministic
 * and evidence-bound — no unconstrained reasoning, no synthesis:
 *   • GO TO   — entity/navigation lookup (handled by the existing palette entity search).
 *   • SHOW ME — a constrained structured query parsed from an ALLOWLIST, resolved as pure SQL over
 *               canonical read-models under RLS. It can only filter existing facts, never invent one.
 *   • EXPLAIN — retrieves the canonical facts/reasons behind an existing record (a route decision, a
 *               timing state, a condition) and renders them verbatim. No new narrative.
 * Anything unmatched fails honestly ("No matching records" / "not supported yet").
 */

export type Intent = "goto" | "showme" | "explain";

export interface QueryHit { group: string; label: string; sub: string | null; href: string; }
export interface Explanation {
  title: string;
  subtitle: string;
  lines: { label: string; value: string }[];
  grounding: string[];   // the canonical sources this explanation was read from
}
export interface ResolveResult {
  intent: Intent;
  interpreted: string | null;   // human-readable read-back of the parsed query (SHOW ME)
  results: QueryHit[];
  explanation: Explanation | null;
  note: string | null;          // honest failure text
}

// ---- Intent classification (rule-based, no model) --------------------------
const EXPLAIN_RE = /^\s*(why|explain|how come|what makes)\b/i;
const SHOWME_TOKENS = /(execution[- ]?ready|at[- ]risk|stalling|late[- ]stage|through |via |over \$|under \$|>\s*\$|renewal|closing|proposal|negotiation|pursuits?|opportunit|deals?)/i;

export function classifyIntent(q: string): Intent {
  if (EXPLAIN_RE.test(q)) return "explain";
  if (SHOWME_TOKENS.test(q)) return "showme";
  return "goto";
}

// ---- SHOW ME: allowlisted structured query --------------------------------
interface ParsedQuery {
  entity: "opportunity";
  conditions: ConditionState[];
  stages: string[];
  partner: string | null;
  amountGt: number | null;
  amountLt: number | null;
}

const money = (s: string): number => {
  const m = s.replace(/[, ]/g, "").match(/\$?([\d.]+)\s*([mk])?/i);
  if (!m) return NaN;
  const n = Number(m[1]); const unit = (m[2] ?? "").toLowerCase();
  return unit === "m" ? n * 1_000_000 : unit === "k" ? n * 1000 : n;
};

/** Parse a SHOW ME query from the allowlist only. Unrecognized tokens are ignored, never guessed. */
export function parseShowMe(q: string): { query: ParsedQuery; interpreted: string } | null {
  const lower = q.toLowerCase();
  const conditions: ConditionState[] = [];
  if (/at[- ]risk/.test(lower)) conditions.push("at_risk");
  if (/stalling/.test(lower)) conditions.push("stalling");
  const stages: string[] = [];
  if (/late[- ]stage/.test(lower)) stages.push("proposal", "negotiation");
  else { for (const st of ["discovery", "qualification", "business_validation", "proposal", "negotiation"]) if (lower.includes(st.replace(/_/g, " ")) || lower.includes(st)) stages.push(st); }
  const partnerMatch = q.match(/(?:through|via)\s+([A-Za-z][\w& .-]{0,40})/i);
  const partner = partnerMatch ? partnerMatch[1].trim().replace(/\b(pursuits?|opportunit\w*|deals?)\b.*$/i, "").trim() : null;
  const gtMatch = lower.match(/(?:over|above|>\s*|greater than\s*)\$?\s*([\d.,]+\s*[mk]?)/);
  const ltMatch = lower.match(/(?:under|below|<\s*|less than\s*)\$?\s*([\d.,]+\s*[mk]?)/);
  const amountGt = gtMatch ? money(gtMatch[1]) : null;
  const amountLt = ltMatch ? money(ltMatch[1]) : null;

  if (!conditions.length && !stages.length && !partner && amountGt == null && amountLt == null) return null;

  const parts: string[] = ["Opportunities"];
  if (conditions.length) parts.push(conditions.map((c) => CONDITION_LABEL[c]).join("/"));
  if (stages.length) parts.push(`stage∈{${[...new Set(stages)].map((s) => s.replace(/_/g, " ")).join(",")}}`);
  if (partner) parts.push(`through ${partner}`);
  if (amountGt != null && Number.isFinite(amountGt)) parts.push(`amount>$${Math.round(amountGt / 1000)}k`);
  if (amountLt != null && Number.isFinite(amountLt)) parts.push(`amount<$${Math.round(amountLt / 1000)}k`);
  return {
    query: { entity: "opportunity", conditions, stages: [...new Set(stages)], partner, amountGt: Number.isFinite(amountGt as number) ? amountGt : null, amountLt: Number.isFinite(amountLt as number) ? amountLt : null },
    interpreted: parts.join(" · "),
  };
}

/** Resolve a parsed SHOW ME query as pure SQL over the canonical opportunity read-model (RLS-scoped). */
export async function resolveShowMe(db: PoolClient, orgId: string, q: ParsedQuery, companyIds: string[] | null): Promise<QueryHit[]> {
  const scoped = companyIds != null;
  const where: string[] = ["o.stage not in ('closed_won','closed_lost')"]; const params: unknown[] = [];
  const P = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (q.partner) where.push(`pa.name ilike ${P(`%${q.partner}%`)}`);
  if (q.stages.length) where.push(`o.stage = any(${P(q.stages)})`);
  if (q.amountGt != null) where.push(`o.amount_usd > ${P(q.amountGt)}`);
  if (q.amountLt != null) where.push(`o.amount_usd < ${P(q.amountLt)}`);
  if (scoped) where.push(`o.company_id = any(${P(companyIds)})`);
  const { rows } = await db.query<{ id: string; name: string; company_id: string; legal_name: string; stage: string; amount_usd: string | null; updated_at: string; partner: string | null }>(
    `select o.id, o.name, o.company_id, c.legal_name, o.stage, o.amount_usd, o.updated_at,
            pa.name partner
       from opportunities o
       join companies c on c.id = o.company_id
       left join revenue_motions m on m.id = o.motion_id
       left join partners pa on pa.id = m.partner_id
      where ${where.join(" and ")}
      order by o.amount_usd desc nulls last limit 25`, params);
  // Condition filter applied in JS via the canonical classifier (silent-days + stage).
  const hits: QueryHit[] = [];
  for (const r of rows) {
    if (q.conditions.length) {
      const cond = opportunityCondition({ stage: r.stage, updatedAt: r.updated_at });
      if (!q.conditions.includes(cond.state)) continue;
    }
    const amt = r.amount_usd != null ? Number(r.amount_usd) : null;
    const sub = [r.stage.replace(/_/g, " "), amt != null ? `$${Math.round(amt / 1000)}k` : null, r.partner ? `via ${r.partner}` : null].filter(Boolean).join(" · ");
    hits.push({ group: "Matches", label: `${r.legal_name} — ${r.name}`, sub, href: `/accounts/${r.company_id}` });
  }
  return hits;
}

// ---- SHOW ME (Motion, P1A): execution-ready accounts within a hypothesis -------------------------
/**
 * "show execution-ready pursuits/accounts [in|for <hypothesis>]" — resolved through the Motion
 * funnel read-model (same gates, same constraints). Deterministic: an unnamed hypothesis lists the
 * ready set of EVERY hypothesis; nothing is guessed.
 */
export function parseMotionShowMe(q: string): { hypothesis: string | null } | null {
  if (!/execution[- ]?ready/i.test(q)) return null;
  const m = q.match(/(?:in|for)\s+(?:the\s+)?([\w][\w& .-]{1,40})\s*$/i);
  return { hypothesis: m ? m[1].trim().replace(/\b(motion|hypothesis)\b\s*$/i, "").trim() || null : null };
}

export async function resolveMotionShowMe(
  db: PoolClient, orgId: string, parsed: { hypothesis: string | null }, companyIds: string[] | null,
): Promise<{ hits: QueryHit[]; interpreted: string }> {
  const funnels = await getMotionFunnels(db, orgId, { companyIds });
  const matched = parsed.hypothesis
    ? funnels.filter((f) => f.hypothesis.name.toLowerCase().includes(parsed.hypothesis!.toLowerCase()) || f.hypothesis.slug.toLowerCase().includes(parsed.hypothesis!.toLowerCase()))
    : funnels;
  const hits: QueryHit[] = [];
  for (const f of matched) {
    for (const a of accountsAtStage(f, "execution_ready").slice(0, 15)) {
      hits.push({
        group: `Execution-ready · ${f.hypothesis.name}`,
        label: a.name,
        sub: a.expectedValue != null ? `$${Math.round(a.expectedValue / 1000)}k expected · ${a.band.replace(/_/g, " ")}` : a.band.replace(/_/g, " "),
        href: a.pursuitId ? `/pursuits/${a.pursuitId}` : `/accounts/${a.companyId}`,
      });
    }
  }
  return { hits, interpreted: `Execution-ready accounts${parsed.hypothesis ? ` · ${parsed.hypothesis}` : ""} (Motion funnel gates)` };
}

// ---- EXPLAIN: evidence-bound explanation of an existing record -------------
/**
 * Resolve an EXPLAIN question to canonical facts + reasons, or an honest "not supported".
 * `orgId` grounds the Motion-funnel intents; the route/timing intents remain RLS-scoped reads.
 */
export async function resolveExplain(db: PoolClient, q: string, orgId?: string): Promise<Explanation | { note: string }> {
  // Identify the subject account by name (the only entity EXPLAIN grounds against today).
  const nameMatch = q.match(/\b(?:is|does|do|are|was)?\s*([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,3})/);
  const candidate = nameMatch ? nameMatch[1].trim() : null;
  if (!candidate) return { note: "This question is not supported yet — try \"why is <account> routed through <partner>?\"" };
  // Prefer a real commercial account (one with a pursuit or opportunity) over incidental name matches,
  // then a prefix match, then the shortest name — deterministic, never a guess about intent.
  const co = (await db.query<{ id: string; legal_name: string }>(
    `select id, legal_name from companies c
      where c.legal_name ilike $1
      order by (exists (select 1 from pursuits p where p.account_id = c.id)) desc,
               (exists (select 1 from opportunities o where o.company_id = c.id)) desc,
               (c.legal_name ilike $2) desc,
               length(c.legal_name) asc
      limit 1`, [`%${candidate}%`, `${candidate}%`])).rows[0];
  if (!co) return { note: "No matching records." };

  const pursuit = (await db.query<{ id: string; use_case: string | null; tim: number | null; why_now: unknown }>(
    `select id, use_case, current_timing_score tim, why_now from pursuits where account_id=$1 order by created_at asc limit 1`, [co.id])).rows[0];

  const asksRoute = /route|through|partner|cdw|wwt|reseller|distributor/i.test(q);
  const asksTiming = /timing|when|renewal|now|urgent/i.test(q);
  const asksReady = /execution[- ]?ready|not\s+ready|isn'?t\s+ready/i.test(q);
  const asksQualify = /qualif/i.test(q);

  // Motion intents (P1A) — grounded in the funnel read-model (same gates, same constraint
  // vocabulary as the Motions room). Hypothesis resolution is deterministic: one named in the
  // question wins; otherwise the account's most recent motion's hypothesis is used AND stated.
  if ((asksReady || asksQualify) && orgId) {
    const node = await resolveHypothesis(db, orgId, q, co.id);
    if (!node) return { note: `No motion hypothesis found for ${co.legal_name} — this question needs an account with an evaluated motion.` };

    if (asksReady) {
      const { account } = await getMotionConstraints(db, orgId, node.id, co.id);
      if (!account) return { note: `${co.legal_name} is not evaluated for ${node.name}.` };
      const gating = account.constraints.filter((c) => c.gating);
      return {
        title: gating.length === 0 ? `${co.legal_name} IS execution-ready — ${node.name}` : `Why ${co.legal_name} is not execution-ready — ${node.name}`,
        subtitle: node.stated ? `Hypothesis: ${node.name} (the account's most recent motion).` : `Hypothesis: ${node.name}.`,
        lines: gating.length === 0
          ? [{ label: "Status", value: "All gates pass — qualified, route decided, timing verified, team accepted, motion approved." }]
          : gating.map((c) => ({ label: c.severity === "UNKNOWN" ? "Unknown" : "Blocking", value: c.label })),
        grounding: ["Motion funnel gates (propensity · route snapshot/disqualifiers · timing · pursuit team · motion status)"],
      };
    }

    // asksQualify — the propensity truth behind qualification, with its top features.
    const prop = (await db.query<{ id: string; score: string; band: string; computed_at: Date }>(
      `select id, score, band, computed_at from propensity_scores
        where company_id = $1 and taxonomy_node_id = $2 and (org_id is null or org_id = $3)
        order by computed_at desc limit 1`, [co.id, node.id, orgId])).rows[0];
    if (!prop) return { note: `${co.legal_name} has not been evaluated for ${node.name} — no propensity score on record.` };
    const feats = (await db.query<{ feature: string; contribution: string | null }>(
      `select feature, contribution from score_features where score_id = $1 order by contribution desc nulls last limit 3`, [prop.id])).rows;
    return {
      title: `Why ${co.legal_name} ${["very_high", "high"].includes(prop.band) ? "qualifies" : "does not qualify"} for ${node.name}`,
      subtitle: `Propensity ${prop.band.replace(/_/g, " ")} (${Math.round(Number(prop.score))}) · scored ${prop.computed_at.toISOString().slice(0, 10)}.`,
      lines: feats.length
        ? feats.map((f) => ({ label: f.feature.replace(/_/g, " "), value: f.contribution != null ? `contribution ${Number(f.contribution).toFixed(1)}` : "present" }))
        : [{ label: "Features", value: "No stored feature breakdown for this score version." }],
      grounding: ["propensity_scores (latest)", "score_features"],
    };
  }

  // Route explanation — recommendation vs human selection, verbatim reasons (recommendation ≠ decision).
  if ((asksRoute || !asksTiming) && pursuit) {
    const route = (await db.query<{ snapshot_id: string; rec: string | null; sel: string | null }>(
      `select s.id snapshot_id, rp.name rec, sp.name sel
         from pursuit_route_snapshots s
         left join partners rp on rp.id = s.recommended_partner_id
         left join partners sp on sp.id = s.selected_partner_id
        where s.pursuit_id=$1 and s.is_current limit 1`, [pursuit.id])).rows[0];
    if (route && (route.rec || route.sel)) {
      const overridden = !!(route.sel && route.rec && route.sel !== route.rec);
      const lines: { label: string; value: string }[] = [];
      if (route.rec) lines.push({ label: "Recommended", value: route.rec });
      if (route.sel) lines.push({ label: "Selected", value: overridden ? `${route.sel} — human override, recommendation preserved` : route.sel });
      // The recommended candidate's own reasons (verbatim); confidential figures withheld from the search surface.
      const reasons = (await db.query<{ detail: string | null; reason_code: string }>(
        `select rr.detail, rr.reason_code
           from route_candidates rc
           join route_candidate_reasons rr on rr.candidate_id = rc.id
          where rc.route_snapshot_id = $1 and rc.is_recommended and rr.polarity = 1
            and rr.disclosure_class not in ('TRANSACTION_CONFIDENTIAL','RESTRICTED','PII')
          order by rr.weight desc nulls last limit 4`, [route.snapshot_id])).rows;
      for (const r of reasons) lines.push({ label: "Because", value: r.detail ?? r.reason_code.replace(/_/g, " ") });
      return {
        title: `Why ${co.legal_name} is routed ${route.sel ? `through ${route.sel}` : "as recommended"}`,
        subtitle: overridden ? "Recommendation ≠ decision — the model's pick is preserved beside the human choice." : "The route on the current snapshot, with its reasons.",
        lines,
        grounding: ["pursuit_route_snapshots (current)", "route_candidate_reasons (recommended, shareable)"],
      };
    }
  }

  // Timing explanation — UNKNOWN stays UNKNOWN (never fabricated).
  if (pursuit) {
    const wn = (pursuit.why_now ?? {}) as { evidence_gap?: string | null; timing_anchor?: unknown };
    const known = pursuit.tim != null;
    return {
      title: `Why now — ${co.legal_name}`,
      subtitle: known ? "Timing has a verified anchor." : "Timing is UNKNOWN — preserved, not assumed.",
      lines: [
        { label: "Timing", value: known ? `${pursuit.tim}` : "UNKNOWN — no verified anchor" },
        ...(wn.evidence_gap ? [{ label: "Missing", value: String(wn.evidence_gap) }] : []),
      ],
      grounding: ["pursuits.current_timing_score", "pursuits.why_now"],
    };
  }

  return { note: "No matching records." };
}

/**
 * Deterministic hypothesis resolution for Motion EXPLAIN intents: a taxonomy node NAMED in the
 * question wins; otherwise the account's most recent motion's node (a fixed rule, and the answer
 * states it — `stated`); zero candidates → null. Never a guess between candidates.
 */
async function resolveHypothesis(
  db: PoolClient, orgId: string, q: string, companyId: string,
): Promise<{ id: string; name: string; stated: boolean } | null> {
  const named = (await db.query<{ id: string; name: string }>(
    `select n.id, n.name from taxonomy_nodes n
      where exists (select 1 from revenue_motions m where m.org_id = $1 and m.taxonomy_node_id = n.id)
        and ($2 ilike '%' || n.name || '%' or $2 ilike '%' || n.slug || '%')
      order by length(n.name) desc limit 1`, [orgId, q])).rows[0];
  if (named) return { ...named, stated: false };
  const recent = (await db.query<{ id: string; name: string }>(
    `select n.id, n.name from revenue_motions m join taxonomy_nodes n on n.id = m.taxonomy_node_id
      where m.org_id = $1 and m.company_id = $2 order by m.created_at desc limit 1`, [orgId, companyId])).rows[0];
  return recent ? { ...recent, stated: true } : null;
}
