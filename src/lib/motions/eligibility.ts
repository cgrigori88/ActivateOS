import type { PoolClient } from "pg";
import { motionV1Of, predicatesOf, type MotionClause, type MotionTemplate, type MotionTemplateV1 } from "./template";

/**
 * DETERMINISTIC MOTION ELIGIBILITY (thin P9).
 *
 * ── THREE STATES, BECAUSE TWO WOULD LIE ─────────────────────────────────────────────────────────
 *
 *   ELIGIBLE             every required clause is satisfied and no disqualifier fires
 *   NOT_ELIGIBLE         a disqualifier fires, or a required clause is DEFINITIVELY false
 *   INSUFFICIENT_CONTEXT a required clause can be neither confirmed nor denied
 *
 * The third state is the whole point. This product holds facts, and a fact that has never been
 * observed is UNKNOWN — not false. Collapsing "we have no renewal date for this account" into "this
 * account does not qualify" would quietly convert missing evidence into a negative finding, which
 * is the defect the repository's missing-context principle exists to prevent.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * A motion-fit verdict is NOT a win probability, a forecast, a score, a ranking or a causal claim.
 * It answers exactly one question: does this commercial pattern appear applicable to this account,
 * given what we hold? Nothing here produces a number, deliberately — a number invites arithmetic
 * that the evidence cannot support.
 *
 * ── AND IT IS NOT P2 ────────────────────────────────────────────────────────────────────────────
 *
 * P2 answers "what deserves attention relative to the current comparison set". This answers "does
 * this pattern fit this subject". They are different quantities over different domains, and this
 * one contributes NOTHING to the ranking: no eligibility value reaches `portfolio-pertinence.ts`,
 * and the suite asserts it.
 *
 * ── BOUNDED READS ───────────────────────────────────────────────────────────────────────────────
 *
 * Portfolio-wide evaluation is THREE statements regardless of how many accounts are considered —
 * facts, partner book, taxonomy — and the clause arithmetic runs in memory. P2's 3N + 9 shape was
 * the lesson; this does not repeat it.
 */

export type Verdict = "ELIGIBLE" | "NOT_ELIGIBLE" | "INSUFFICIENT_CONTEXT";

export interface ClauseResult {
  predicate: string;
  op: string;
  /** TRUE satisfied · FALSE definitively not · null unknown. Three values, never two. */
  satisfied: boolean | null;
  because: string;
  /** Fact ids that answered it — references only, never evidence text (P6). */
  factIds: string[];
}

export interface MotionFit {
  slug: string;
  version: number;
  name: string;
  companyId: string;
  verdict: Verdict;
  /** Clauses that decided the verdict, in declaration order. */
  clauses: ClauseResult[];
  /** Declared things this product cannot observe. Never affects the verdict. */
  missingContext: string[];
}

/**
 * THE COLUMNS A CLAUSE MAY READ.
 *
 * `facts` stores a value in a typed column per `object_type`: a DATE lands in `date_value`, a
 * STRING in `text_value`. `object_value` is jsonb holding notes and bounds — an earlier version of
 * this evaluator read it for both and would have matched nothing, forever, while reporting
 * "insufficient context" and looking entirely reasonable.
 */
interface FactRow {
  id: string; company_id: string; predicate_key: string; object_type: string | null;
  text_value: string | null; date_value: Date | null; number_value: string | null;
}

/**
 * Evaluate every template against every company, in bounded reads.
 *
 * `asOf` is captured once by the caller and threaded, exactly as P2 requires: two accounts must
 * never be judged against two instants.
 */
export async function evaluateMotions(
  db: PoolClient, orgId: string, templates: MotionTemplate[], companyIds: string[], asOf: Date,
): Promise<Map<string, MotionFit[]>> {
  const out = new Map<string, MotionFit[]>();
  if (companyIds.length === 0 || templates.length === 0) return out;

  const wanted = [...new Set(templates.flatMap((t) => predicatesOf(t.motion)))];
  // ONE statement for every fact that any clause could consult. Live facts only: the same
  // supersession and validity-window rule the value case uses, so two parts of the product cannot
  // disagree about what is currently true.
  const { rows: facts } = await db.query<FactRow>(
    `select f.id, f.company_id, f.predicate_key, f.object_type, f.text_value, f.date_value, f.number_value
       from facts f
      where f.org_id = $1 and f.company_id = any($2::uuid[]) and f.predicate_key = any($3::text[])
        and f.superseded_by is null and f.status not in ('SUPERSEDED', 'REJECTED')
        and (f.valid_from is null or f.valid_from <= $4)
        and (f.valid_until is null or f.valid_until > $4)`,
    [orgId, companyIds, wanted, asOf]);

  // ONE statement for the partner book — the canonical whitespace shape.
  const { rows: book } = await db.query<{ company_id: string; installed: boolean; target_product: string | null }>(
    `select company_id, installed, target_product from partner_accounts
      where org_id = $1 and company_id = any($2::uuid[])`, [orgId, companyIds]);

  const factsByCompany = new Map<string, FactRow[]>();
  for (const f of facts) (factsByCompany.get(f.company_id) ?? factsByCompany.set(f.company_id, []).get(f.company_id)!).push(f);
  const bookByCompany = new Map<string, { installed: boolean; target_product: string | null }[]>();
  for (const b of book) (bookByCompany.get(b.company_id) ?? bookByCompany.set(b.company_id, []).get(b.company_id)!).push(b);

  for (const companyId of companyIds) {
    const mine = factsByCompany.get(companyId) ?? [];
    const fits: MotionFit[] = [];
    for (const t of templates) {
      fits.push(evaluateOne(t, companyId, mine, bookByCompany.get(companyId) ?? [], asOf));
    }
    out.set(companyId, fits);
  }
  return out;
}

function evaluateOne(
  t: MotionTemplate, companyId: string, facts: FactRow[],
  book: { installed: boolean; target_product: string | null }[], asOf: Date,
): MotionFit {
  const m = t.motion;
  const clauses: ClauseResult[] = [];

  // Disqualifiers first: a motion that is inapplicable is inapplicable whatever else holds, and
  // saying so is more useful than reporting which requirements it happened to meet.
  for (const c of m.disqualifiers ?? []) {
    const r = testClause(c, facts, asOf);
    clauses.push({ ...r, because: c.because });
    if (r.satisfied === true) {
      return { slug: t.slug, version: t.version, name: t.name, companyId, verdict: "NOT_ELIGIBLE", clauses, missingContext: m.requiresContext ?? [] };
    }
  }

  let unknown = false;
  for (const c of m.requires) {
    const r = testClause(c, facts, asOf);
    clauses.push({ ...r, because: c.because });
    if (r.satisfied === false) {
      return { slug: t.slug, version: t.version, name: t.name, companyId, verdict: "NOT_ELIGIBLE", clauses, missingContext: m.requiresContext ?? [] };
    }
    if (r.satisfied === null) unknown = true;
  }

  if (m.partnerContext?.whitespace) {
    // WHITESPACE IS A THREE-STATE TEST TOO. An account on no partner's book tells us nothing about
    // whitespace; an account on a book with the product already installed tells us plenty.
    const onBook = book.length > 0;
    const anyUninstalled = book.some((b) => !b.installed);
    const result: ClauseResult = {
      predicate: "partner_accounts.installed", op: "whitespace",
      satisfied: !onBook ? null : anyUninstalled ? true : false,
      because: anyUninstalled
        ? "a partner holds this account and the product is not yet installed"
        : onBook ? "a partner holds this account and the product is already installed"
          : "no partner book covers this account, so whitespace cannot be established",
      factIds: [],
    };
    clauses.push(result);
    if (result.satisfied === false) {
      return { slug: t.slug, version: t.version, name: t.name, companyId, verdict: "NOT_ELIGIBLE", clauses, missingContext: m.requiresContext ?? [] };
    }
    if (result.satisfied === null) unknown = true;
  }

  return {
    slug: t.slug, version: t.version, name: t.name, companyId,
    verdict: unknown ? "INSUFFICIENT_CONTEXT" : "ELIGIBLE",
    clauses, missingContext: m.requiresContext ?? [],
  };
}

/**
 * One clause against one account's live facts.
 *
 * ABSENCE RETURNS null, NEVER false. That single decision is what keeps "we have not looked" from
 * being recorded as "we looked and it is not so".
 */
function testClause(c: MotionClause, facts: FactRow[], asOf: Date): Omit<ClauseResult, "because"> {
  const mine = facts.filter((f) => f.predicate_key === c.predicate);
  const base = { predicate: c.predicate, op: c.op, factIds: mine.map((f) => f.id) };
  if (mine.length === 0) return { ...base, satisfied: null };

  if (c.op === "present") return { ...base, satisfied: true };

  if (c.op === "value_in") {
    const want = (c.values ?? []).map((v) => v.toLowerCase());
    const hit = mine.filter((f) => f.text_value && want.some((w) => f.text_value!.toLowerCase().includes(w)));
    // A fact exists and does not match: that IS a definitive negative, unlike absence.
    return { ...base, satisfied: hit.length > 0, factIds: (hit.length ? hit : mine).map((f) => f.id) };
  }

  if (c.op === "within_days") {
    const horizon = asOf.getTime() + (c.days ?? 0) * 86_400_000;
    const dated = mine
      .filter((f) => f.date_value != null)
      .map((f) => ({ f, at: f.date_value!.getTime() }));
    // A date predicate whose value is not a date answers nothing.
    if (dated.length === 0) return { ...base, satisfied: null };
    const inWindow = dated.filter((x) => x.at <= horizon && x.at >= asOf.getTime() - 86_400_000);
    return { ...base, satisfied: inWindow.length > 0, factIds: (inWindow.length ? inWindow : dated).map((x) => x.f.id) };
  }

  return { ...base, satisfied: null };
}

/**
 * Load the thin-P9 templates, proving every predicate they name actually exists.
 *
 * A template naming an unknown predicate is REFUSED rather than silently evaluating to unknown
 * forever — a rule that can never be satisfied is a defect in the template, and hiding it as
 * "insufficient context" would make it indistinguishable from an account we simply lack data on.
 */
export async function loadMotionTemplates(db: PoolClient): Promise<MotionTemplate[]> {
  const { rows } = await db.query<{ id: string; slug: string; version: number; name: string; taxonomy_node_id: string | null; taxonomy_slug: string | null; definition: unknown }>(
    `select pt.id, pt.slug, pt.version, pt.name, pt.taxonomy_node_id, n.slug as taxonomy_slug, pt.definition
       from play_templates pt
       left join taxonomy_nodes n on n.id = pt.taxonomy_node_id
      where pt.status = 'active'
      order by pt.slug, pt.version desc`);
  const { rows: preds } = await db.query<{ key: string }>(`select key from fact_predicates`);
  const known = new Set(preds.map((p) => p.key));

  const out: MotionTemplate[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.slug)) continue;            // highest active version per slug, and only that one
    const motion = motionV1Of(r.definition);
    if (!motion) continue;                      // an older template with no thin-P9 block
    const unknownPreds = predicatesOf(motion).filter((p) => !known.has(p));
    if (unknownPreds.length) {
      throw new Error(`motion template ${r.slug}@${r.version} names predicates that do not exist: ${unknownPreds.join(", ")}`);
    }
    seen.add(r.slug);
    const def = r.definition as { seller_cadence?: { step: number; action: string; day: number }[] };
    out.push({
      slug: r.slug, version: r.version, name: r.name,
      taxonomyNodeId: r.taxonomy_node_id, taxonomySlug: r.taxonomy_slug,
      motion, cadence: def.seller_cadence ?? [],
    });
  }
  return out;
}
