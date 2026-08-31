import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";
import { LADDER_OF, DRIVER_LABEL, type Ladder } from "./drivers";

/**
 * Governed economic assertion (P2B §7). The ONLY legal way to record an authoritative economic
 * fact — bound to `dispatchSkill` as `assert_economic_fact`. Migration 0099's trigger rejects any
 * insert or update of an economic-family fact carrying a trusted provenance class outside this
 * handler's transaction-local flag, so there is **no direct CRUD bypass**.
 *
 * The guard is deliberately scoped to *authoritative* assertions. A pipeline may still write an
 * INFERRED or THIRD_PARTY_UNVERIFIED economic fact without this path, because a model proposing a
 * number is a different act from a human asserting one — and §7 requires exactly that distinction
 * to remain visible ("human-confirmed economics must be distinguishable from inferred/model-
 * generated economics"). The provenance class carries it, and the ladder projects it.
 *
 * What the authoritative path preserves, per §7:
 *   actor           → change_ledger actor + facts.created_by_actor_type / created_via
 *   organization    → facts.org_id (RLS-scoped)
 *   Pursuit         → change_ledger pursuit_id (the fact itself is account-scoped, as economics are)
 *   predicate/driver→ facts.predicate_key
 *   value/range     → money_amount (point) or object_value {low,high} (range)
 *   provenance      → facts.provenance_class → the ladder rung
 *   source/evidence → facts.subject_label + fact_evidence + the ledger entry
 *   prior fact      → facts.supersedes / superseded_by (append-only; nothing is overwritten)
 *   audit history   → change_ledger ECONOMIC_FACT_ASSERTED with before/after
 */

/** Provenance classes an actor may claim, and what each requires. */
const REQUIRES_EVIDENCE = new Set(["FIRST_PARTY", "THIRD_PARTY_VERIFIED", "CUSTOMER_DECLARED"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssertEconomicArgs {
  companyId: string;
  predicateKey: string;
  /** A point value. Mutually exclusive with low/high. */
  amount?: number | null;
  /** A bounded value. Both required together. */
  low?: number | null;
  high?: number | null;
  currency?: string;
  /** Canonical provenance class. The ladder rung is derived from it, never asserted directly. */
  provenanceClass: string;
  /** Where the number came from, in words. */
  source: string;
  /** Why PursuitOS should believe it. Required for any provenance claiming verification. */
  evidence?: string | null;
  /** Disclosure class for this fact. Defaults to INTERNAL — never partner-visible by accident. */
  disclosureClass?: string | null;
  pursuitId?: string | null;
}

export interface AssertEconomicResult {
  factId: string;
  ladder: Ladder;
  superseded: { factId: string; low: number; high: number } | null;
}

/** dispatchSkill precheck: the account (and pursuit, when given) must belong to the actor's org. */
export async function economicSubjectInOrg(
  db: PoolClient, orgId: string, args: Record<string, unknown> | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  const companyId = args?.companyId ? String(args.companyId) : null;
  const predicateKey = args?.predicateKey ? String(args.predicateKey) : null;
  if (!companyId || !predicateKey) return { ok: false, reason: "missing companyId/predicateKey" };

  const pred = (await db.query<{ family: string | null }>(
    `select family from fact_predicates where key = $1 and status = 'active'`, [predicateKey])).rows[0];
  if (!pred) return { ok: false, reason: `unknown predicate ${predicateKey}` };
  if (pred.family !== "economic") return { ok: false, reason: `${predicateKey} is not an economic driver` };

  // The account must be reachable in this org's world — an economic assertion against a company
  // this org has no relationship with is a governed REJECTION, audited, not a silent write.
  const seen = (await db.query<{ n: string }>(
    `select count(*)::text n from (
       select 1 from pursuits where account_id = $1 and org_id = $2
       union all select 1 from revenue_motions where company_id = $1 and org_id = $2
       union all select 1 from opportunities where company_id = $1 and org_id = $2
       union all select 1 from facts where company_id = $1 and org_id = $2
     ) x`, [companyId, orgId])).rows[0];
  if (Number(seen.n) === 0) return { ok: false, reason: "account not found in this org" };

  if (args?.pursuitId) {
    const p = (await db.query<{ org_id: string }>(
      `select org_id from pursuits where id = $1`, [String(args.pursuitId)])).rows[0];
    if (!p || p.org_id !== orgId) return { ok: false, reason: "pursuit not found in this org" };
  }
  return { ok: true };
}

export async function assertEconomicFact(
  db: PoolClient,
  actor: { type: string; id?: string | null; orgId: string },
  raw: Record<string, unknown>,
  env: DataEnvironment = "PRODUCTION",
): Promise<AssertEconomicResult> {
  const args: AssertEconomicArgs = {
    companyId: String(raw.companyId ?? ""),
    predicateKey: String(raw.predicateKey ?? ""),
    amount: raw.amount != null ? Number(raw.amount) : null,
    low: raw.low != null ? Number(raw.low) : null,
    high: raw.high != null ? Number(raw.high) : null,
    currency: raw.currency ? String(raw.currency) : "USD",
    provenanceClass: String(raw.provenanceClass ?? ""),
    source: String(raw.source ?? ""),
    evidence: raw.evidence != null ? String(raw.evidence) : null,
    disclosureClass: raw.disclosureClass != null ? String(raw.disclosureClass) : "INTERNAL",
    pursuitId: raw.pursuitId != null ? String(raw.pursuitId) : null,
  };

  // ── Validation: refuse rather than record something meaningless ──────────────────────────────
  if (!args.source) throw new Error("assert_economic_fact: source is required (where the number came from)");
  const ladder = LADDER_OF[args.provenanceClass];
  if (!ladder) throw new Error(`assert_economic_fact: unknown provenance class ${args.provenanceClass}`);

  const isRange = args.low != null && args.high != null;
  const isPoint = args.amount != null;
  if (isRange === isPoint) {
    throw new Error("assert_economic_fact: provide either a point `amount` or both `low` and `high`, not both and not neither");
  }
  if (isRange && args.low! > args.high!) throw new Error("assert_economic_fact: low exceeds high");

  // An AGENT may propose, never verify. Verification is a human act — the same rule P1C applies to
  // stakeholder roles, for the same reason: a model cannot witness a customer's books.
  if (actor.type === "AGENT" && (ladder === "VERIFIED" || ladder === "CUSTOMER_CONFIRMED")) {
    throw new Error("assert_economic_fact: an agent may propose an economic figure but may not assert it as verified or customer-confirmed");
  }
  // A rung claiming verification must say what verified it.
  if (REQUIRES_EVIDENCE.has(args.provenanceClass) && !args.evidence) {
    throw new Error(`assert_economic_fact: provenance ${args.provenanceClass} requires stated evidence`);
  }

  const label = DRIVER_LABEL[args.predicateKey] ?? args.predicateKey.replace(/_/g, " ");
  const identity = `${actor.orgId}:${args.companyId}:${args.predicateKey}`;
  const low = isRange ? args.low! : args.amount!;
  const high = isRange ? args.high! : args.amount!;

  // Everything below runs with the governed flag set, transaction-locally. The 0099 trigger admits
  // an authoritative economic write ONLY while this flag is on, and it is never set anywhere else.
  await db.query(`select set_config('app.governed_economic_assertion','1',true)`);
  try {
    // The prior assertion, if any — superseded, never overwritten.
    const prior = (await db.query<{ id: string; money_amount: string | null; object_value: { low?: number; high?: number } | null }>(
      `select id, money_amount, object_value from facts
        where org_id = $1 and fact_identity_key = $2 and status = 'CURRENT' and superseded_by is null
        order by observed_last_at desc limit 1`, [actor.orgId, identity])).rows[0];

    const factId = randomUUID();
    // Supersession is THREE steps, because two constraints pull in opposite directions:
    //   `facts_current_slot`      unique (org_id, fact_identity_key) WHERE status = 'CURRENT'
    //                             ⇒ the prior row must leave CURRENT before the new one arrives;
    //   `facts_superseded_by_fkey` superseded_by references facts(id)
    //                             ⇒ the new row must exist before the prior can point at it.
    // So: (1) retire the prior, (2) insert the new, (3) link the prior forward. Nothing is ever
    // overwritten and the history is never ambiguous at any point in between.
    if (prior) {
      await db.query(
        `update facts set status = 'SUPERSEDED' where id = $1 and org_id = $2`,
        [prior.id, actor.orgId]);
    }
    await db.query(
      `insert into facts (
         id, org_id, subject_scope, subject_ref, subject_label, company_id, predicate_key,
         object_type, object_value, money_amount, money_currency, number_value,
         polarity, status, confidence, provenance_class, origin_kind,
         as_of, observed_at, observed_first_at, observed_last_at,
         freshness_policy, half_life_days, family, disclosure_class,
         fact_identity_key, fact_value_key, data_environment, is_simulated,
         created_by_actor_type, created_via, data_lineage, supersedes)
       values ($1,$2,'COMPANY',$3,$4,$3,$5,
               $6,$7::jsonb,$8,$9,$10,
               1,'CURRENT',$11,$12,'HUMAN',
               now(),now(),now(),now(),
               'DECAYING',365,'economic',$13,
               $14,$15,$16,$17,
               $18,'assert_economic_fact',$19::jsonb,$20)`,
      [factId, actor.orgId, args.companyId, args.source, args.predicateKey,
       isRange ? "RANGE" : "MONEY",
       JSON.stringify(isRange ? { low, high } : {}),
       isRange ? null : args.amount, args.currency,
       args.predicateKey === "time_to_value_months" ? (args.amount ?? low) : null,
       ladder === "VERIFIED" ? 0.95 : ladder === "CUSTOMER_CONFIRMED" ? 0.9 : ladder === "INFERRED" ? 0.5 : 0.3,
       args.provenanceClass, args.disclosureClass,
       identity, `${identity}:${low}:${high}`,
       env, env !== "PRODUCTION",
       actor.type, JSON.stringify({ source: args.source, evidence: args.evidence, assertedBy: actor.id ?? null }),
       prior?.id ?? null]);

    if (prior) {
      await db.query(
        `update facts set superseded_by = $1 where id = $2 and org_id = $3`,
        [factId, prior.id, actor.orgId]);
    }

    // `fact_evidence` links a fact to an `evidence` ROW, not to free text, so a stated evidence
    // sentence is preserved where it belongs: in the fact's data_lineage (above) and in the
    // append-only ledger entry (below). When the assertion cites an existing evidence record by id,
    // the canonical link is made here.
    const evidenceId = raw.evidenceId != null ? String(raw.evidenceId) : null;
    if (evidenceId) {
      await db.query(
        `insert into fact_evidence (fact_id, evidence_id, stance, weight, observed_at, linked_by, linked_at)
         select $1, e.id, 'SUPPORTS', 1.0, now(), $3, now() from evidence e
          where e.id = $2 and e.org_id = $4
         on conflict do nothing`,
        [factId, evidenceId, actor.type, actor.orgId]);
    }

    const priorBounds = prior
      ? {
          factId: prior.id,
          low: prior.object_value?.low ?? Number(prior.money_amount ?? 0),
          high: prior.object_value?.high ?? Number(prior.money_amount ?? 0),
        }
      : null;

    await recordChange(db, {
      orgId: actor.orgId,
      pursuitId: args.pursuitId ?? null,
      entityType: "fact",
      entityId: factId,
      changeType: "ECONOMIC_FACT_ASSERTED" as never,
      reason: `${label} asserted as ${ladder.toLowerCase().replace(/_/g, "-")} from ${args.source}`
        + (args.evidence ? ` — evidence: ${args.evidence}` : ""),
      before: priorBounds,
      after: { factId, predicateKey: args.predicateKey, low, high, ladder, provenanceClass: args.provenanceClass },
      materiality: "HIGH",
      actorType: actor.type as never,
      // change_ledger.actor_id is a uuid. A non-uuid actor identifier (a service name, a demo
      // operator) is kept in the fact's data_lineage instead of breaking the audit write.
      actorId: UUID_RE.test(actor.id ?? "") ? actor.id! : null,
      dataEnvironment: env,
    });

    return { factId, ladder, superseded: priorBounds };
  } finally {
    // Best-effort reset. If the transaction already aborted, this query would itself fail and
    // MASK the original error — the flag is transaction-local and dies with the transaction anyway.
    await db.query(`select set_config('app.governed_economic_assertion','',true)`).catch(() => {});
  }
}
