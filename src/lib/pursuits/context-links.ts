import type { PoolClient } from "pg";

/**
 * Many-to-many shared-context linkage (Workstream A, §16-17). Evidence/Signals/Facts/
 * Interactions/Relationships are canonical account/context objects that MULTIPLE
 * pursuits may consume; never duplicate the source. Each link carries relevance
 * metadata so the same Fact can be a PRIMARY_TRIGGER for one pursuit and
 * SUPPORTING_CONTEXT for another.
 */

export type ContextKind = "evidence" | "signals" | "facts" | "interactions" | "relationships";
export type RelevanceType = "PRIMARY_TRIGGER" | "SUPPORTING_CONTEXT" | "CONTRADICTING" | "BACKGROUND";

const TABLE: Record<ContextKind, string> = {
  evidence: "pursuit_evidence",
  signals: "pursuit_signals",
  facts: "pursuit_facts",
  interactions: "pursuit_interactions",
  relationships: "pursuit_relationships",
};

export interface LinkOptions {
  relevanceType?: RelevanceType;
  relevanceScore?: number | null;
  reason?: string | null;
  linkedBy?: string | null;
}

/** Link (idempotent) a canonical context object to a pursuit. RLS scopes via the pursuit's org. */
export async function linkContext(
  db: PoolClient,
  kind: ContextKind,
  pursuitId: string,
  refId: string,
  opts: LinkOptions = {},
): Promise<void> {
  const t = TABLE[kind];
  await db.query(
    `insert into ${t} (pursuit_id, ref_id, relevance_type, relevance_score, reason, linked_by)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (pursuit_id, ref_id) do update
       set relevance_type = excluded.relevance_type,
           relevance_score = excluded.relevance_score,
           reason = excluded.reason`,
    [pursuitId, refId, opts.relevanceType ?? "SUPPORTING_CONTEXT", opts.relevanceScore ?? null, opts.reason ?? null, opts.linkedBy ?? null],
  );
}

export async function unlinkContext(db: PoolClient, kind: ContextKind, pursuitId: string, refId: string): Promise<void> {
  await db.query(`delete from ${TABLE[kind]} where pursuit_id = $1 and ref_id = $2`, [pursuitId, refId]);
}
