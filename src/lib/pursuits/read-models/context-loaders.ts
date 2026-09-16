import type { PoolClient } from "pg";
import { familiesFromSignalTypes } from "@/lib/intel/company-intel";
import { deriveRelevance } from "@/lib/facts/pursuit-link";
import { meddpiccFor } from "@/lib/opportunities/meddpicc";
import type { Meddpicc } from "@/lib/opportunities/meddpicc";
import { getStakeholderCoverage } from "@/lib/stakeholders/coverage";
import { getValueCase } from "@/lib/value/case";
import {
  computeContextHealth,
  type ContextFactInput,
  type ContextHealthInput,
  type ContextHealthView,
  type FactRelevanceType,
  type FactStatus,
  type ProvenanceClass,
} from "./context-health";
import { getPursuitWhyNow } from "./detail";
import type { Caller } from "./helpers";
import {
  buildPursuitMemory,
  type LedgerActorType,
  type LedgerMateriality,
  type LedgerRow,
  type LedgerTriggerType,
  type PursuitMemoryOptions,
  type PursuitMemoryView,
} from "./memory";
import {
  composeMissingContext,
  type MissingContextInput,
  type MissingContextView,
} from "./missing-context";
import {
  composePursuitEvidence,
  type EvidenceFactInput,
  type PursuitEvidenceView,
} from "./pursuit-evidence";
import {
  canDisclose,
  rankPertinence,
  type DecisionContext,
  type PertinenceCandidate,
  type PertinenceView,
} from "./pertinence";
import type { DisclosureClass } from "./types";

/**
 * Loaders for the Living Pursuit Context read-models (vNext Slice 1, chunk 5A).
 *
 * These are deliberately THIN. Their entire job is fetch → scope → normalize →
 * map onto the input contracts the four read-models already declare. Every
 * judgement — what counts as fresh, what counts as covered, what counts as
 * material, what counts as a gap, how things rank — lives in the primitives and
 * the read-models, not here. If you find yourself writing a threshold or a
 * weight in this file, it belongs somewhere else.
 *
 * TENANT SCOPING IS EXPLICIT, NOT INHERITED. Every query carries an `org_id`
 * predicate. RLS exists and is correct, but the application currently connects
 * as a role with BYPASSRLS, so the database belt is inert on this path (task
 * #67). The application-layer predicate is the control that actually runs today,
 * and these loaders must not be the place that forgets it.
 *
 * DISCLOSURE IS APPLIED AT THIS BOUNDARY. Nothing restricted leaves a loader.
 * For pertinence that matters especially: an item the caller may not see is
 * dropped here, before it can influence the ranking of anything that remains
 * (D-018). `rankPertinence` filters again — the two are idempotent, and
 * defence in depth on a disclosure boundary is worth the redundancy.
 *
 * NULL DISCLOSURE = INTERNAL. `facts.disclosure_class` (migration 0099) is
 * nullable, and the existing canonical rule is explicit about this: `PARTNER_WITHHELD`
 * in `src/lib/value/drivers.ts` documents "NULL = unclassified = INTERNAL" and
 * `partnerVisible()` treats null as withheld. These loaders normalize null to
 * INTERNAL so the same thing happens here. Fail closed.
 *
 * Read-only: no INSERT, no UPDATE, no DELETE, no DDL, no schema addition.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** The 6-value canonical vocabulary. Anything unrecognised — including null — is INTERNAL. */
const DISCLOSURE_VALUES: ReadonlySet<string> = new Set<DisclosureClass>([
  "PUBLIC", "INTERNAL", "PARTNER_SHARED", "TRANSACTION_CONFIDENTIAL", "PII", "RESTRICTED",
]);

function normalizeDisclosure(value: string | null): DisclosureClass {
  return value != null && DISCLOSURE_VALUES.has(value) ? (value as DisclosureClass) : "INTERNAL";
}

interface PursuitRow {
  id: string;
  org_id: string;
  account_id: string;
  use_case: string | null;
  status: string;
  data_environment: string;
}

/** Resolve the pursuit within the caller's tenant. Null when it is not theirs to read. */
async function loadPursuit(db: PoolClient, caller: Caller, pursuitId: string): Promise<PursuitRow | null> {
  const { rows } = await db.query<PursuitRow>(
    `select id, org_id, account_id, use_case, status, data_environment
       from pursuits where id = $1 and org_id = $2`,
    [pursuitId, caller.orgId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// 1 · Context health
// ---------------------------------------------------------------------------

interface LinkedFactRow {
  fact_id: string;
  predicate_key: string;
  subject_label: string;
  relevance_type: string | null;
  status: string;
  confidence: string;
  provenance_class: string;
  freshness_policy: string;
  observed_last_at: Date;
  half_life_days: number | null;
  valid_until: Date | null;
  occurred_at: Date | null;
  superseded_by: string | null;
  disclosure_class: string | null;
}

/**
 * Project `pursuit_facts ⋈ facts` plus research coverage and open contradictions
 * onto `ContextHealthInput`.
 *
 * `requiredCategories` is deliberately NOT set here. Which coverage categories a
 * given use-case depends on is a policy question, and inventing that mapping in
 * a loader would be exactly the second business-logic layer this chunk is
 * supposed to avoid. Left undefined, `computeContextHealth` judges against every
 * category — the honest default when the dependency is undeclared. Declaring the
 * mapping is follow-up work, and it belongs next to the other coverage policy.
 */
export async function loadContextHealthInput(
  db: PoolClient, caller: Caller, pursuitId: string, now?: Date,
): Promise<ContextHealthInput | null> {
  const p = await loadPursuit(db, caller, pursuitId);
  if (!p) return null;

  const [linked, providerRuns, signalTypes, contradictions] = await Promise.all([
    db.query<LinkedFactRow>(
      `select f.id as fact_id, f.predicate_key, f.subject_label, pf.relevance_type,
              f.status, f.confidence, f.provenance_class, f.freshness_policy,
              f.observed_last_at, f.half_life_days, f.valid_until, f.occurred_at,
              f.superseded_by, f.disclosure_class
         from pursuit_facts pf
         join facts f on f.id = pf.ref_id
        where pf.pursuit_id = $1 and f.org_id = $2`,
      [pursuitId, caller.orgId],
    ),
    db.query<{ provider_id: string }>(
      `select provider_id from provider_runs
        where company_id = $1 and org_id = $2 and status = 'succeeded'
        group by provider_id`,
      [p.account_id, caller.orgId],
    ),
    db.query<{ signal_type: string }>(
      `select distinct signal_type from signals where company_id = $1 and org_id = $2`,
      [p.account_id, caller.orgId],
    ),
    db.query<{ n: string }>(
      `select count(*)::text as n
         from fact_contradictions fc
        where fc.org_id = $2 and fc.status = 'open'
          and (fc.fact_id_a in (select ref_id from pursuit_facts where pursuit_id = $1)
            or fc.fact_id_b in (select ref_id from pursuit_facts where pursuit_id = $1))`,
      [pursuitId, caller.orgId],
    ),
  ]);

  // Disclosure at the boundary: a fact the caller may not see does not become
  // part of their context-health picture at all.
  const facts: ContextFactInput[] = linked.rows
    .filter((r) => canDisclose(caller, normalizeDisclosure(r.disclosure_class)))
    .map((r) => ({
      factId: r.fact_id,
      predicateKey: r.predicate_key,
      label: r.subject_label,
      // `pursuit_facts.relevance_type` is nullable; SUPPORTING_CONTEXT is the
      // neutral member of the existing vocabulary, not a new default.
      relevance: (r.relevance_type ?? "SUPPORTING_CONTEXT") as FactRelevanceType,
      status: r.status as FactStatus,
      confidence: Number(r.confidence),
      provenanceClass: r.provenance_class as ProvenanceClass,
      freshnessPolicy: r.freshness_policy as ContextFactInput["freshnessPolicy"],
      observedLastAt: r.observed_last_at,
      halfLifeDays: r.half_life_days,
      validUntil: r.valid_until,
      occurredAt: r.occurred_at,
      superseded: r.superseded_by != null,
    }));

  return {
    pursuitId,
    facts,
    completeness: {
      providersRun: new Set(providerRuns.rows.map((r) => r.provider_id)),
      familiesPresent: familiesFromSignalTypes(signalTypes.rows.map((r) => r.signal_type)),
    },
    openContradictions: Number(contradictions.rows[0]?.n ?? 0),
    now,
  };
}

/** Convenience: load and compute in one call. */
export async function loadContextHealth(
  db: PoolClient, caller: Caller, pursuitId: string, now?: Date,
): Promise<ContextHealthView | null> {
  const input = await loadContextHealthInput(db, caller, pursuitId, now);
  return input ? computeContextHealth(input) : null;
}

// ---------------------------------------------------------------------------
// 2 · Memory
// ---------------------------------------------------------------------------

interface LedgerDbRow {
  id: string;
  pursuit_id: string | null;
  entity_type: string;
  entity_id: string | null;
  change_type: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  materiality: string;
  reason: string | null;
  actor_type: string | null;
  actor_id: string | null;
  trigger_type: string | null;
  trigger_id: string | null;
  model_version: string | null;
  agent_run_id: string | null;
  data_environment: string;
  occurred_at: Date;
  recorded_at: Date;
}

/**
 * Project `change_ledger` onto `LedgerRow[]`.
 *
 * NO MATERIALITY PREDICATE. That is the whole point of the memory read-model,
 * and it is the one thing a well-meaning optimisation would add. LOW entries
 * such as `FACT_LINKED_TO_PURSUIT` are the connective tissue of "how did we get
 * here" — the What-Changed feed filters them out deliberately, and memory must
 * not.
 *
 * Ordered by `occurred_at desc` in SQL so the existing
 * `(pursuit_id, occurred_at desc)` index serves the read directly. The
 * read-model re-sorts into whichever direction the caller asked for, so this
 * ordering is an index hint, not a contract.
 */
export async function loadPursuitLedgerRows(
  db: PoolClient, caller: Caller, pursuitId: string, limit = 500,
): Promise<LedgerRow[]> {
  const { rows } = await db.query<LedgerDbRow>(
    `select id, pursuit_id, entity_type, entity_id, change_type, before_state, after_state,
            materiality, reason, actor_type, actor_id, trigger_type, trigger_id,
            model_version, agent_run_id, data_environment, occurred_at, recorded_at
       from change_ledger
      where pursuit_id = $1 and org_id = $2
      order by occurred_at desc, id desc
      limit $3`,
    [pursuitId, caller.orgId, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    pursuitId: r.pursuit_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    changeType: r.change_type,
    beforeState: r.before_state,
    afterState: r.after_state,
    materiality: r.materiality as LedgerMateriality,
    reason: r.reason,
    actorType: r.actor_type as LedgerActorType | null,
    actorId: r.actor_id,
    triggerType: r.trigger_type as LedgerTriggerType | null,
    triggerId: r.trigger_id,
    modelVersion: r.model_version,
    agentRunId: r.agent_run_id,
    dataEnvironment: r.data_environment,
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
  }));
}

/** Convenience: load and build in one call. */
export async function loadPursuitMemory(
  db: PoolClient, caller: Caller, pursuitId: string, opts: PursuitMemoryOptions = {},
): Promise<PursuitMemoryView> {
  const rows = await loadPursuitLedgerRows(db, caller, pursuitId);
  return buildPursuitMemory(pursuitId, rows, caller, opts);
}

// ---------------------------------------------------------------------------
// 3 · Missing context
// ---------------------------------------------------------------------------

/**
 * Gather the four existing gap computations, plus context health.
 *
 * The `undefined` / `null` distinction is load-bearing and is preserved exactly:
 *   • `undefined` — this source was not evaluated (we did not look)
 *   • `null`      — evaluated, and there is nothing to evaluate against
 * `composeMissingContext` reports the first in `notEvaluated` and treats the
 * second as an honest NOT_ESTABLISHED. Collapsing them would let "we did not
 * look" read as "we looked and found nothing", which is the one reassurance a
 * gap read-model must never give falsely.
 */
export async function loadMissingContextInput(
  db: PoolClient, caller: Caller, pursuitId: string, now?: Date,
): Promise<MissingContextInput | null> {
  const p = await loadPursuit(db, caller, pursuitId);
  if (!p) return null;

  const [contextHealth, stakeholderCoverage, valueCase, whyNow] = await Promise.all([
    loadContextHealth(db, caller, pursuitId, now),
    getStakeholderCoverage(db, caller.orgId, pursuitId),
    getValueCase(db, caller.orgId, pursuitId),
    getPursuitWhyNow(db, caller.orgId, pursuitId),
  ]);

  // MEDDPICC hangs off opportunities, and the pursuit→opportunity link is the
  // one stakeholder coverage already resolved. No linked opportunity ⇒ null
  // ("nothing to qualify"), never an empty Meddpicc that would read as eight
  // unknown elements the team failed to capture.
  let meddpicc: Meddpicc | null = null;
  const opportunityId = stakeholderCoverage?.opportunityIds[0];
  if (opportunityId) {
    meddpicc = (await meddpiccFor(db, caller.orgId, [opportunityId])).get(opportunityId) ?? null;
  }

  return {
    pursuitId,
    caller,
    contextHealth,
    stakeholderCoverage,
    valueCase: valueCase ? { state: valueCase.state, missingDrivers: valueCase.missing } : null,
    whyNow,
    meddpicc,
    now,
  };
}

/** Convenience: load and compose in one call. */
export async function loadMissingContext(
  db: PoolClient, caller: Caller, pursuitId: string, now?: Date,
): Promise<MissingContextView | null> {
  const input = await loadMissingContextInput(db, caller, pursuitId, now);
  return input ? composeMissingContext(input) : null;
}

// ---------------------------------------------------------------------------
// 4 · Pertinence
// ---------------------------------------------------------------------------

export interface PertinenceLoadOptions {
  decisionContext?: DecisionContext;
  limit?: number;
  /** How many remembered events to offer as candidates. Default 40. */
  memoryLimit?: number;
  now?: Date;
}

/**
 * Assemble the authorized candidate set: linked facts, remembered events and
 * open gaps, competing on one list.
 *
 * Facts and events carry a real disclosure class; gaps are derived from
 * already-disclosure-filtered inputs, so they inherit INTERNAL rather than
 * claiming a classification they do not have. Everything is filtered here,
 * before ranking — see D-018.
 */
export async function loadPertinenceCandidates(
  db: PoolClient, caller: Caller, pursuitId: string, opts: PertinenceLoadOptions = {},
): Promise<PertinenceCandidate[] | null> {
  const p = await loadPursuit(db, caller, pursuitId);
  if (!p) return null;

  const [linked, memory, missing] = await Promise.all([
    db.query<LinkedFactRow>(
      `select f.id as fact_id, f.predicate_key, f.subject_label, pf.relevance_type,
              f.status, f.confidence, f.provenance_class, f.freshness_policy,
              f.observed_last_at, f.half_life_days, f.valid_until, f.occurred_at,
              f.superseded_by, f.disclosure_class
         from pursuit_facts pf
         join facts f on f.id = pf.ref_id
        where pf.pursuit_id = $1 and f.org_id = $2 and f.status <> 'REJECTED'`,
      [pursuitId, caller.orgId],
    ),
    loadPursuitMemory(db, caller, pursuitId, { order: "newest", limit: opts.memoryLimit ?? 40 }),
    loadMissingContext(db, caller, pursuitId, opts.now),
  ]);

  const candidates: PertinenceCandidate[] = [];

  for (const r of linked.rows) {
    const disclosure = normalizeDisclosure(r.disclosure_class);
    if (!canDisclose(caller, disclosure)) continue;
    candidates.push({
      id: `fact:${r.fact_id}`,
      kind: "FACT",
      label: r.subject_label,
      disclosure,
      at: r.observed_last_at,
      relevance: (r.relevance_type ?? "SUPPORTING_CONTEXT") as FactRelevanceType,
      confidence: Number(r.confidence),
      // DISPUTED is an open question; every other surviving status is settled.
      unresolved: r.status === "DISPUTED",
      refType: "fact",
      refId: r.fact_id,
    });
  }

  // Memory entries are already disclosure-handled by `buildPursuitMemory`, which
  // withholds state payloads from callers without internal visibility. Only the
  // label and metadata are offered here, never the payload.
  for (const e of memory.entries) {
    candidates.push({
      id: `event:${e.id}`,
      kind: "EVENT",
      label: e.reason ?? e.changeType,
      disclosure: "INTERNAL",
      at: new Date(e.occurredAt),
      materiality: e.materiality,
      unresolved: false,
      refType: "change",
      refId: e.id,
    });
  }

  // Gaps come from `composeMissingContext`, which has already excluded anything
  // the caller is not entitled to. Nothing withheld can reach this list.
  //
  // The upstream `rank` and `source` travel WITH the candidate. They are what the
  // gap layer decided about importance and provenance, and pertinence must not
  // silently re-derive a coarser version of either (D-019).
  for (const g of missing?.gaps ?? []) {
    candidates.push({
      id: `gap:${g.key}`,
      kind: "GAP",
      label: g.text,
      disclosure: "INTERNAL",
      at: null,
      gapKind: g.kind,
      gapRank: g.rank,
      gapSource: g.source,
      whyItMatters: g.whyItMatters,
      unresolved: true,
      refType: g.refType,
      refId: g.refId,
    });
  }

  return candidates.filter((c) => canDisclose(caller, c.disclosure));
}

/** Convenience: load and rank in one call. */
export async function loadPertinence(
  db: PoolClient, caller: Caller, pursuitId: string, opts: PertinenceLoadOptions = {},
): Promise<PertinenceView | null> {
  const candidates = await loadPertinenceCandidates(db, caller, pursuitId, opts);
  if (!candidates) return null;
  return rankPertinence({
    pursuitId,
    caller,
    candidates,
    decisionContext: opts.decisionContext,
    limit: opts.limit,
    now: opts.now,
  });
}

// ---------------------------------------------------------------------------
// 5 · Pursuit evidence (direct + supporting)
// ---------------------------------------------------------------------------

interface AccountFactRow {
  fact_id: string;
  predicate_key: string;
  subject_label: string;
  family: string | null;
  status: string;
  confidence: string;
  polarity: number;
  provenance_class: string;
  disclosure_class: string | null;
  freshness_policy: string;
  observed_last_at: Date;
  half_life_days: number | null;
  valid_until: Date | null;
  occurred_at: Date | null;
  superseded_by: string | null;
  linked_relevance: string | null;
  linked_at: Date | null;
  linked_by_type: string | null;
  link_reason: string | null;
}

export interface PursuitEvidenceLoadOptions {
  decisionContext?: DecisionContext;
  minSupportingBand?: "low" | "moderate" | "high" | "very_high";
  supportingLimit?: number;
  now?: Date;
}

/**
 * Project the account's facts, LEFT JOINed to this pursuit's `pursuit_facts`
 * rows, onto `EvidenceFactInput[]`.
 *
 * One left join answers both questions at once: every authorized account fact is
 * a candidate, and the presence of `pf.relevance_type` is what makes a fact
 * DIRECT. Nothing here decides membership by score.
 *
 * `deriveRelevance()` is called per distinct predicate — the SAME canonical
 * function `linkFactToPursuits` uses — so a supporting fact is typed exactly as
 * it would be if someone linked it. Calling it does NOT link anything: no row is
 * written, and the derived value travels as ranking input only.
 */
export async function loadPursuitEvidenceInput(
  db: PoolClient, caller: Caller, pursuitId: string, opts: PursuitEvidenceLoadOptions = {},
): Promise<{ accountId: string; accountFacts: EvidenceFactInput[] } | null> {
  const p = await loadPursuit(db, caller, pursuitId);
  if (!p) return null;

  const { rows } = await db.query<AccountFactRow>(
    `select f.id as fact_id, f.predicate_key, f.subject_label, f.family,
            f.status, f.confidence, f.polarity, f.provenance_class, f.disclosure_class,
            f.freshness_policy, f.observed_last_at, f.half_life_days, f.valid_until,
            f.occurred_at, f.superseded_by,
            pf.relevance_type as linked_relevance, pf.linked_at, pf.linked_by_type,
            pf.reason as link_reason
       from facts f
       left join pursuit_facts pf on pf.ref_id = f.id and pf.pursuit_id = $1
      where f.company_id = $2 and f.org_id = $3`,
    [pursuitId, p.account_id, caller.orgId],
  );

  // Derive once per (predicate, polarity) rather than per row — the predicate
  // table is cached, but the pair is the only thing the derivation depends on.
  const derived = new Map<string, FactRelevanceType>();
  for (const r of rows) {
    const key = `${r.predicate_key}|${r.polarity}`;
    if (!derived.has(key)) {
      derived.set(key, await deriveRelevance(db, r.predicate_key, r.polarity) as FactRelevanceType);
    }
  }

  const accountFacts: EvidenceFactInput[] = rows.map((r) => ({
    factId: r.fact_id,
    predicateKey: r.predicate_key,
    subjectLabel: r.subject_label,
    family: r.family,
    status: r.status as FactStatus,
    confidence: Number(r.confidence),
    provenanceClass: r.provenance_class as ProvenanceClass,
    disclosure: normalizeDisclosure(r.disclosure_class),
    freshnessPolicy: r.freshness_policy as EvidenceFactInput["freshnessPolicy"],
    observedLastAt: r.observed_last_at,
    halfLifeDays: r.half_life_days,
    validUntil: r.valid_until,
    occurredAt: r.occurred_at,
    superseded: r.superseded_by != null,
    linkedRelevance: r.linked_relevance as FactRelevanceType | null,
    linkedAt: r.linked_at,
    linkedByType: r.linked_by_type,
    linkReason: r.link_reason,
    derivedRelevance: derived.get(`${r.predicate_key}|${r.polarity}`) ?? "SUPPORTING_CONTEXT",
  }));

  return { accountId: p.account_id, accountFacts };
}

/** Convenience: load and compose in one call. */
export async function loadPursuitEvidence(
  db: PoolClient, caller: Caller, pursuitId: string, opts: PursuitEvidenceLoadOptions = {},
): Promise<PursuitEvidenceView | null> {
  const loaded = await loadPursuitEvidenceInput(db, caller, pursuitId, opts);
  if (!loaded) return null;
  return composePursuitEvidence({
    pursuitId,
    accountId: loaded.accountId,
    caller,
    accountFacts: loaded.accountFacts,
    decisionContext: opts.decisionContext,
    minSupportingBand: opts.minSupportingBand,
    supportingLimit: opts.supportingLimit,
    now: opts.now,
  });
}
