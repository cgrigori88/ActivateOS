import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * MEDDPICC — the shared qualification metrology for pipeline. Eight elements,
 * each rated on a coarse strength ladder that humans and the AI both speak. The
 * per-element rows double as training data: each assessment is a labeled example
 * banked against the opportunity's eventual outcome (see the close snapshot in
 * advanceOpportunity → outcome_events).
 */

export type ElementKey =
  | "metrics"
  | "economic_buyer"
  | "decision_criteria"
  | "decision_process"
  | "paper_process"
  | "identified_pain"
  | "champion"
  | "competition";

export type Status = "unknown" | "gap" | "weak" | "strong";

export interface Element {
  key: ElementKey;
  letter: string;
  label: string;
  hint: string;
}

export const ELEMENTS: Element[] = [
  { key: "metrics", letter: "M", label: "Metrics", hint: "Quantified economic impact the buyer will measure." },
  { key: "economic_buyer", letter: "E", label: "Economic buyer", hint: "The person with budget authority is identified and engaged." },
  { key: "decision_criteria", letter: "D", label: "Decision criteria", hint: "The technical & business criteria we're being judged on." },
  { key: "decision_process", letter: "D", label: "Decision process", hint: "The steps, owners, and timeline to a decision." },
  { key: "paper_process", letter: "P", label: "Paper process", hint: "Procurement, legal, security review path to signature." },
  { key: "identified_pain", letter: "I", label: "Identified pain", hint: "A compelling, owned pain driving urgency." },
  { key: "champion", letter: "C", label: "Champion", hint: "An internal advocate with power who sells when we're not there." },
  { key: "competition", letter: "C", label: "Competition", hint: "Alternatives (incl. do-nothing) and our differentiation." },
];

export const STATUS_POINTS: Record<Status, number> = { unknown: 0, gap: 0, weak: 1, strong: 2 };
export const STATUS_LABEL: Record<Status, string> = { unknown: "Unknown", gap: "Gap", weak: "Weak", strong: "Strong" };
export const STATUS_TONE: Record<Status, string> = {
  unknown: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  gap: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  weak: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  strong: "bg-green-100 text-positive dark:bg-green-950 dark:text-green-300",
};

export interface ElementState {
  status: Status;
  notes: string | null;
  source: string;
}

export type Meddpicc = Record<ElementKey, ElementState>;

const blank = (): Meddpicc =>
  Object.fromEntries(ELEMENTS.map((e) => [e.key, { status: "unknown" as Status, notes: null, source: "human" }])) as Meddpicc;

/** 0–100 qualification health across the eight elements. */
export function meddpiccScore(m: Meddpicc): number {
  const pts = ELEMENTS.reduce((s, e) => s + STATUS_POINTS[m[e.key].status], 0);
  return Math.round((pts / (ELEMENTS.length * 2)) * 100);
}

/** The elements still unknown or flagged as gaps — the qualification to-do. */
export function meddpiccGaps(m: Meddpicc): Element[] {
  return ELEMENTS.filter((e) => m[e.key].status === "unknown" || m[e.key].status === "gap");
}

/** Load MEDDPICC for many opportunities at once (blanks fill missing elements). */
export async function meddpiccFor(db: Db, opportunityIds: string[]): Promise<Map<string, Meddpicc>> {
  const out = new Map<string, Meddpicc>();
  if (opportunityIds.length === 0) return out;
  for (const id of opportunityIds) out.set(id, blank());
  const { rows } = await db.query<{ opportunity_id: string; element: ElementKey; status: Status; notes: string | null; source: string }>(
    `select opportunity_id, element, status, notes, source
     from opportunity_meddpicc where opportunity_id = any($1)`,
    [opportunityIds],
  );
  for (const r of rows) {
    const m = out.get(r.opportunity_id);
    if (m) m[r.element] = { status: r.status, notes: r.notes, source: r.source };
  }
  return out;
}

export async function upsertElement(
  db: Db,
  args: { opportunityId: string; element: ElementKey; status: Status; notes: string | null; source?: string; updatedBy?: string },
): Promise<void> {
  await db.query(
    `insert into opportunity_meddpicc (opportunity_id, element, status, notes, source, updated_by, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (opportunity_id, element)
       do update set status = excluded.status, notes = excluded.notes,
                     source = excluded.source, updated_by = excluded.updated_by, updated_at = now()`,
    [args.opportunityId, args.element, args.status, args.notes, args.source ?? "human", args.updatedBy ?? "web"],
  );
}

/**
 * Evidence-grounded assessment. Reads the opportunity's stakeholders, verified
 * evidence, and amount, then proposes a status + note per element. Runs entirely
 * on real signals we hold (no external model needed), so it works in every
 * environment; every proposal is a draft (source='ai_assist') the human tunes.
 */
export async function assessMeddpicc(db: Db, opportunityId: string): Promise<{ updated: number }> {
  const { rows: oppRows } = await db.query<{ company_id: string; amount_usd: string | null; motion_id: string | null }>(
    `select company_id, amount_usd, motion_id from opportunities where id = $1`,
    [opportunityId],
  );
  if (oppRows.length === 0) throw new Error("opportunity not found");
  const opp = oppRows[0];

  const { rows: sh } = await db.query<{ role: string; sentiment: string; name: string | null }>(
    `select s.role, s.sentiment, ct.name from stakeholders s join contacts ct on ct.id = s.contact_id
     where s.opportunity_id = $1`,
    [opportunityId],
  );
  const roles = new Set(sh.map((s) => s.role));
  const eb = sh.find((s) => s.role === "economic_buyer");
  const champ = sh.find((s) => s.role === "champion");

  const { rows: ev } = await db.query<{ claim: string; source_type: string }>(
    `select claim, source_type from evidence
     where company_id = $1 and status = 'verified'
     order by computed_confidence desc nulls last, observed_at desc limit 6`,
    [opp.company_id],
  );
  const painEv = ev.find((e) => /migrat|end.of.life|eol|outage|risk|cost|scal|deadline|compliance|breach|expir/i.test(e.claim));
  const compEv = ev.find((e) => /competitor|incumbent|vmware|veeam|broadcom|replace|rip.and.replace|alternative/i.test(e.claim));

  const has = (n: number) => ev.length >= n;
  const proposals: Record<ElementKey, { status: Status; notes: string }> = {
    metrics: opp.amount_usd
      ? { status: "weak", notes: `Deal sized at ~$${Math.round(Number(opp.amount_usd) / 1000)}k; quantify the buyer's own before/after metric.` }
      : { status: "gap", notes: "No economic metric captured yet — tie the pain to a number the buyer tracks." },
    economic_buyer: eb
      ? { status: eb.sentiment === "positive" ? "strong" : "weak", notes: `Economic buyer: ${eb.name ?? "identified"} (${eb.sentiment}).` }
      : { status: "gap", notes: "Budget authority not mapped — identify who signs." },
    decision_criteria: has(2)
      ? { status: "weak", notes: "Some criteria inferable from evidence; confirm the buyer's explicit scorecard." }
      : { status: "unknown", notes: "Capture the technical & business criteria we're judged on." },
    decision_process: { status: "unknown", notes: "Map the steps, owners, and dates to a decision." },
    paper_process: { status: "unknown", notes: "Confirm procurement, legal, and security review path." },
    identified_pain: painEv
      ? { status: "strong", notes: `Compelling event in evidence: ${painEv.claim.slice(0, 120)}` }
      : has(1)
        ? { status: "weak", notes: "Pain implied by intelligence; get the buyer to own it explicitly." }
        : { status: "gap", notes: "No compelling event captured — surface the driver of urgency." },
    champion: champ
      ? { status: champ.sentiment === "positive" ? "strong" : "weak", notes: `Champion: ${champ.name ?? "identified"} (${champ.sentiment}).` }
      : roles.has("influencer")
        ? { status: "weak", notes: "Influencer engaged; develop them into a power champion." }
        : { status: "gap", notes: "No champion yet — recruit an advocate with influence." },
    competition: compEv
      ? { status: "weak", notes: `Competitive context: ${compEv.claim.slice(0, 120)}` }
      : { status: "unknown", notes: "Identify alternatives (incl. do-nothing) and our wedge." },
  };

  let updated = 0;
  for (const e of ELEMENTS) {
    // Only fill elements the human hasn't already set (never overwrite a human).
    const { rows: existing } = await db.query<{ source: string }>(
      `select source from opportunity_meddpicc where opportunity_id = $1 and element = $2`,
      [opportunityId, e.key],
    );
    if (existing.length > 0 && existing[0].source === "human") continue;
    const p = proposals[e.key];
    await upsertElement(db, { opportunityId, element: e.key, status: p.status, notes: p.notes, source: "ai_assist", updatedBy: "ai" });
    updated += 1;
  }
  return { updated };
}
