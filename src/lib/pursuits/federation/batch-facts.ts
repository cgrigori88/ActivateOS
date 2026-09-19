import type { PoolClient } from "pg";
import type { FederationViewer } from "./disclosure";
import { INPUT_CLASS_REGISTRY, type DerivationFacts, type DerivationGrant } from "./derivation";

/**
 * D-S14-EXECUTION-BOUND — GOVERNANCE FACTS FOR A WHOLE COHORT, IN A BOUNDED NUMBER OF STATEMENTS.
 *
 * > **Batching changes how facts are fetched, never how authority or disclosure is decided.**
 *
 * The governed read used to acquire its facts one pursuit at a time: a viewer query and an allowlist
 * query per row, plus one to three derivation queries per foreign row. The statement graph was
 * therefore `Σ cost(candidate)` with cost in {3,4,5,6} — linear in a cohort whose size the registry
 * does not bound, which is the total-work half of D-S14-EXECUTION-BOUND.
 *
 * This module loads the SAME facts, with the SAME predicates, for a set of pursuits at once. It
 * decides nothing: `decideDerivation` and `resolveDisclosure` remain the only implementations of the
 * rules, and this file must never acquire a rule of its own. A SQL `may_derive()` would have been
 * the other way to bound the work and was rejected by ruling — two rule engines would then have to
 * be proven equivalent forever.
 *
 * ONE INSTANT. Every predicate below reads `transaction_timestamp()` inside the statement, exactly
 * as the one-row loaders do, so the participant window, the grant window and `can_see_pursuit`
 * evaluate against one identical instant at microsecond precision (D-P6-1, `governanceClock`).
 */

/** One candidate as the caller already loaded it — nothing here re-reads the pursuit row. */
export interface CohortSubject {
  id: string;
  /** `pursuits.org_id` — the sponsor, and the source org of its contributions. */
  ownerOrgId: string;
  /**
   * `status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null`, computed in
   * the candidate query. A PURSUIT_LIFETIME grant is bounded by this; it is loaded with the
   * candidate rather than re-read per member because it is the same row in the same transaction.
   */
  live: boolean;
}

/** Viewer standing per member. Metric-independent, so it is loaded once for the whole request. */
export interface CohortViewers {
  /** The R6 viewer for one member — sponsor standing, participation, allow-listed object keys. */
  viewer(pursuitId: string): FederationViewer;
}

/** Derivation facts per member, for ONE metric's input kind and purpose. */
export interface CohortDerivationFacts {
  /**
   * The facts `decideDerivation` needs about one member.
   *
   * `effectiveParticipant` is the VIEWER's fact and is passed in rather than re-queried here: the
   * participation predicate was already evaluated once for the whole cohort by `loadCohortViewers`,
   * and asking the database again would pay twice for one answer. It is a PARAMETER rather than a
   * default so this loader never states a participation fact it did not establish.
   */
  derivation(pursuitId: string, effectiveParticipant: boolean): DerivationFacts;
}

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * TWO STATEMENTS, whatever the cohort's size: participation standing and allow-listed object keys.
 * Neither depends on which metric is being computed, so a plan naming several metrics still pays for
 * this once.
 */
export async function loadCohortViewers(
  db: PoolClient,
  viewerOrgId: string,
  subjects: readonly CohortSubject[],
  asOfInstant: Date | null = null,
): Promise<CohortViewers> {
  const ids = subjects.map((s) => s.id);
  const participants = new Set<string>();
  const allowlist = new Map<string, Set<string>>();

  if (ids.length > 0) {
    // 1. PARTICIPATION — character-for-character the predicate `buildFederationViewer` and
    //    `mayDerive` both use, evaluated for every member at once.
    const { rows: standing } = await db.query<{ id: string; participant: boolean }>(
      `select p.id,
              exists (select 1 from pursuit_participants pp
                       where pp.pursuit_id = p.id and pp.org_id = $1
                         and pp.participation_state = 'ACTIVE'
                         and (pp.effective_from is null or pp.effective_from <= coalesce($3::timestamptz, transaction_timestamp()))
                         and (pp.effective_to   is null or pp.effective_to   >  coalesce($3::timestamptz, transaction_timestamp()))) as participant
         from pursuits p where p.id = any($2::uuid[])`,
      [viewerOrgId, ids, asOfInstant]);
    for (const r of standing) if (r.participant) participants.add(r.id);

    // 2. ALLOW-LISTED OBJECT KEYS — `allowlistKeysFor`, for the whole set. `now()` is
    //    `transaction_timestamp()`, which is the instant every other predicate here reads.
    const { rows: keyed } = await db.query<{ pursuit_id: string; scope: { keys?: string[] } | null }>(
      `select pursuit_id, scope from context_grants
        where to_org_id = $1 and pursuit_id = any($2::uuid[])
          and grant_kind = 'DATA' and status = 'accepted'
          and (expires_at is null or expires_at > now())`,
      [viewerOrgId, ids]);
    for (const r of keyed) {
      const set = allowlist.get(r.pursuit_id) ?? new Set<string>();
      for (const k of r.scope?.keys ?? []) set.add(k);
      allowlist.set(r.pursuit_id, set);
    }
  }

  const ownerById = new Map(subjects.map((s) => [s.id, s.ownerOrgId]));
  return {
    viewer(pursuitId: string): FederationViewer {
      return {
        orgId: viewerOrgId,
        isSponsor: ownerById.get(pursuitId) === viewerOrgId,
        isParticipant: participants.has(pursuitId),
        allowlistGrantedFor: allowlist.get(pursuitId) ?? (EMPTY_KEYS as Set<string>),
      };
    },
  };
}

/**
 * ONE statement, and only when the cohort actually crosses an organization boundary: a self-owned
 * member never consults a grant, so a single-tenant cohort issues this query not at all.
 */
export async function loadCohortDerivationFacts(
  db: PoolClient,
  viewerOrgId: string,
  subjects: readonly CohortSubject[],
  operation: { inputKind: string; purpose: string; asOf?: Date | null },
): Promise<CohortDerivationFacts> {
  const asOf = operation.asOf ?? null;
  const grants = new Map<string, DerivationGrant[]>();
  const foreign = subjects.filter((s) => s.ownerOrgId !== viewerOrgId);
  const cls = INPUT_CLASS_REGISTRY[operation.inputKind];

  if (foreign.length > 0 && cls) {
    const { rows } = await db.query<DerivationGrant & { pursuit_id: string; from_org_id: string }>(
      `select id, pursuit_id, from_org_id, purpose_code, retention_class, scope
         from context_grants
        where to_org_id = $1 and pursuit_id = any($2::uuid[])
          and grant_kind = 'DATA' and status = 'accepted'
          and purpose_code is not null
          and purpose_code = $3
          and governed_information_classes is not null and $4 = any(governed_information_classes)
          and (expires_at is null or expires_at > coalesce($5::timestamptz, transaction_timestamp()))
        order by id`,
      [viewerOrgId, foreign.map((s) => s.id), operation.purpose, cls, asOf]);
    const ownerOf = new Map(foreign.map((s) => [s.id, s.ownerOrgId]));
    for (const r of rows) {
      // `from_org_id = sourceOrgId` is a clause of the one-row query; here the source org is the
      // member's owner, so the same restriction is applied as a join in memory rather than lost.
      if (ownerOf.get(r.pursuit_id) !== r.from_org_id) continue;
      const list = grants.get(r.pursuit_id) ?? [];
      list.push({ id: r.id, purpose_code: r.purpose_code, retention_class: r.retention_class, scope: r.scope });
      grants.set(r.pursuit_id, list);
    }
  }

  const liveById = new Map(subjects.map((s) => [s.id, s.live]));
  return {
    derivation(pursuitId: string, effectiveParticipant: boolean): DerivationFacts {
      return {
        effectiveParticipant,
        grants: grants.get(pursuitId) ?? [],
        pursuitLive: liveById.get(pursuitId) ?? false,
      };
    },
  };
}
