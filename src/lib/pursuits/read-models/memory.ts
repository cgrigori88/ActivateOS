import type { Caller } from "./helpers";

/**
 * Pursuit Memory (vNext Slice 1, chunk 2).
 *
 * MEMORY IS NOT "WHAT CHANGED". They are two different read-models over one
 * append-only ledger, and conflating them is the specific defect this chunk
 * exists to fix:
 *
 *   `getPursuitTimeline` (read-models/detail.ts) filters by
 *   `isTimelineWorthy(materiality)` and orders by `recorded_at desc`. That is
 *   correct for an executive attention feed — you do not want LOW-materiality
 *   noise in "what needs my attention" — and wrong for a memory, which must be
 *   complete and must run in the order things actually happened.
 *
 * So this module:
 *   • orders by `occurred_at` (BUSINESS time — when the change happened in the
 *     world), not `recorded_at` (RECORD time — when PursuitOS wrote the row).
 *     `change_ledger` carries both deliberately, and its pursuit index is
 *     already `(pursuit_id, occurred_at desc)`, so this is also the cheaper read;
 *   • does NOT filter by materiality. Materiality is preserved on every entry so
 *     a surface can emphasise, collapse or hide — but never so an event is
 *     absent from the record of how the pursuit got here;
 *   • keeps ACTOR (who or what performed the change) separate from TRIGGER (what
 *     caused it), which the ledger models separately for exactly this reason;
 *   • preserves provenance: model version and agent run id travel with any
 *     machine-authored entry, so a generated change is never indistinguishable
 *     from a human one.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. No narrative prose — that belongs to a
 * later layer, and generated narrative must never replace the canonical record
 * it summarises. No mutation: the ledger is append-only at the grant level
 * (`app_rw` holds SELECT/INSERT but no UPDATE/DELETE on `change_ledger`), and
 * this module treats its inputs as immutable, copying rather than editing.
 *
 * DISCLOSURE. `change_ledger` carries no disclosure classification of its own,
 * so this module does not invent one. It gates on the capability the caller
 * already carries: a guest tenant — a partner brought in through the consent
 * fabric — sees that a change happened, with its type, time, actor kind and
 * materiality, but not the raw `before_state`/`after_state` payloads, which can
 * contain internal commercial detail. The withholding happens here, server-side,
 * so the payload never contains what the caller may not see.
 *
 * Pure and deterministic. No database access, no clock of its own, no model.
 */

// ---------------------------------------------------------------------------
// Input — a straight projection of `change_ledger` (migration 0065, types
// extended by 0073/0079/0084). Column names are camel-cased and nothing else is
// reinterpreted, so the chunk-5 loader is mechanical.
// ---------------------------------------------------------------------------

export type LedgerActorType = "USER" | "AGENT" | "WORKER" | "SYSTEM" | "IMPORT" | "API";

export type LedgerTriggerType =
  | "EVIDENCE_VERIFIED" | "FACT_PROMOTED" | "INTERACTION_RECEIVED" | "SCHEDULED_REFRESH"
  | "USER_OVERRIDE" | "CRM_SYNC" | "PARTNER_DECISION" | "MODEL_RECALCULATION"
  | "MIGRATION" | "MANUAL" | "CONTRADICTION";

export type LedgerMateriality = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface LedgerRow {
  id: string;
  pursuitId: string | null;
  entityType: string;
  entityId: string | null;
  changeType: string;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  materiality: LedgerMateriality;
  reason: string | null;
  actorType: LedgerActorType | null;
  actorId: string | null;
  triggerType: LedgerTriggerType | null;
  triggerId: string | null;
  modelVersion: string | null;
  agentRunId: string | null;
  dataEnvironment: string;
  /** Business time — when the change happened. The ordering key. */
  occurredAt: Date;
  /** Record time — when PursuitOS wrote the row. Kept, never used for ordering. */
  recordedAt: Date;
}

export interface PursuitMemoryOptions {
  /**
   * "oldest" reads as a history (how did we get here); "newest" reads as a feed.
   * Default "oldest", because the question this read-model answers is the former.
   */
  order?: "oldest" | "newest";
  /** Bound the window. Applied AFTER ordering, so a limit never silently reorders. */
  limit?: number;
  /**
   * Gap, in hours, above which consecutive entries are marked as starting a new
   * `episodeIndex`. Purely a grouping hint for a later surface; it changes no
   * content and drops nothing. Default 72h.
   */
  episodeGapHours?: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface MemoryActor {
  /** null when the ledger row recorded no actor — reported as unknown, not guessed. */
  type: LedgerActorType | null;
  id: string | null;
  /** True when the change was machine-authored. Drives "who said this?" honestly. */
  automated: boolean;
}

export interface MemoryTrigger {
  type: LedgerTriggerType | null;
  id: string | null;
}

export interface MemoryProvenance {
  modelVersion: string | null;
  agentRunId: string | null;
  /** True when a model produced this change and its version is known. */
  modelAttributed: boolean;
}

export interface MemoryEntry {
  id: string;
  changeType: string;
  entityType: string;
  entityId: string | null;
  /** The ledger's own `reason`. Never generated, never rewritten. */
  reason: string | null;
  materiality: LedgerMateriality;
  /** Business time, ISO. The ordering key. */
  occurredAt: string;
  /** Record time, ISO. Preserved separately — these are not interchangeable. */
  recordedAt: string;
  /**
   * Hours between the event happening and PursuitOS learning about it. Positive
   * means the record lagged reality. Surfaces a backfill or a late CRM sync
   * without anyone having to diff two timestamps by eye.
   */
  recordLagHours: number;
  /** True when the record lagged the event by more than the episode gap. */
  recordedLate: boolean;
  actor: MemoryActor;
  trigger: MemoryTrigger;
  provenance: MemoryProvenance;
  /** DEMO/synthetic lineage, preserved so a synthetic entry is always labelable. */
  synthetic: boolean;
  /** Withheld from callers without internal visibility — see the module note. */
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  /** True when state payloads exist but were withheld from this caller. */
  stateWithheld: boolean;
  /** Grouping hint only. Consecutive entries within `episodeGapHours` share an index. */
  episodeIndex: number;
}

export interface PursuitMemoryView {
  pursuitId: string;
  entries: MemoryEntry[];
  /** Total entries available before `limit` — so a surface can say "showing N of M". */
  totalAvailable: number;
  /** Business-time span of the returned entries. */
  firstOccurredAt: string | null;
  lastOccurredAt: string | null;
  order: "oldest" | "newest";
  /** Counts by materiality across the RETURNED entries. Nothing was filtered out. */
  byMateriality: Record<LedgerMateriality, number>;
  /** True when any entry was machine-authored. */
  hasAutomatedEntries: boolean;
  /** True when any entry's record time lagged its business time. */
  hasLateRecords: boolean;
}

const AUTOMATED_ACTORS: ReadonlySet<LedgerActorType> = new Set<LedgerActorType>(["AGENT", "WORKER", "SYSTEM", "IMPORT", "API"]);

const HOUR_MS = 3_600_000;

/**
 * Build the chronological memory for one pursuit.
 *
 * `rows` are expected to be this pursuit's ledger rows; scoping to the pursuit
 * and the tenant is the caller's job (it happens in SQL, under RLS). Rows for a
 * different pursuit are dropped rather than silently mixed in, since a memory
 * that quietly contains another pursuit's history is worse than an empty one.
 */
export function buildPursuitMemory(
  pursuitId: string,
  rows: readonly LedgerRow[],
  caller: Caller,
  opts: PursuitMemoryOptions = {},
): PursuitMemoryView {
  const order = opts.order ?? "oldest";
  const episodeGapHours = opts.episodeGapHours ?? 72;

  const mine = rows.filter((r) => r.pursuitId === pursuitId);

  // Order by BUSINESS time. `id` breaks ties so the result is stable for events
  // that share a timestamp — without it, a limit could return different rows run
  // to run, which would make the memory non-deterministic.
  const chronological = [...mine].sort((a, b) => {
    const d = a.occurredAt.getTime() - b.occurredAt.getTime();
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  // Episodes are assigned in true chronological order so the grouping means the
  // same thing regardless of which direction the caller reads.
  const episodeOf = new Map<string, number>();
  let episode = 0;
  let prev: Date | null = null;
  for (const r of chronological) {
    if (prev && (r.occurredAt.getTime() - prev.getTime()) / HOUR_MS > episodeGapHours) episode++;
    episodeOf.set(r.id, episode);
    prev = r.occurredAt;
  }

  const ordered = order === "newest" ? [...chronological].reverse() : chronological;
  const windowed = opts.limit != null && opts.limit >= 0 ? ordered.slice(0, opts.limit) : ordered;

  const entries: MemoryEntry[] = windowed.map((r) => {
    const automated = r.actorType != null && AUTOMATED_ACTORS.has(r.actorType);
    const hasState = r.beforeState != null || r.afterState != null;
    const withheld = hasState && !caller.canSeeInternal;
    const lagHours = (r.recordedAt.getTime() - r.occurredAt.getTime()) / HOUR_MS;

    return {
      id: r.id,
      changeType: r.changeType,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      materiality: r.materiality,
      occurredAt: r.occurredAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
      recordLagHours: Math.round(lagHours * 100) / 100,
      recordedLate: lagHours > episodeGapHours,
      actor: { type: r.actorType, id: r.actorId, automated },
      trigger: { type: r.triggerType, id: r.triggerId },
      provenance: {
        modelVersion: r.modelVersion,
        agentRunId: r.agentRunId,
        modelAttributed: automated && r.modelVersion != null,
      },
      synthetic: r.dataEnvironment !== "PRODUCTION",
      // Copied, never the caller's object: the ledger is append-only and this
      // read-model must not hand out a mutable handle onto its source rows.
      beforeState: withheld ? null : r.beforeState ? { ...r.beforeState } : null,
      afterState: withheld ? null : r.afterState ? { ...r.afterState } : null,
      stateWithheld: withheld,
      episodeIndex: episodeOf.get(r.id) ?? 0,
    };
  });

  const byMateriality: Record<LedgerMateriality, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const e of entries) byMateriality[e.materiality]++;

  return {
    pursuitId,
    entries,
    totalAvailable: mine.length,
    firstOccurredAt: chronological[0]?.occurredAt.toISOString() ?? null,
    lastOccurredAt: chronological[chronological.length - 1]?.occurredAt.toISOString() ?? null,
    order,
    byMateriality,
    hasAutomatedEntries: entries.some((e) => e.actor.automated),
    hasLateRecords: entries.some((e) => e.recordedLate),
  };
}
