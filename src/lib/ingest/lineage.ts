import type { PoolClient } from "pg";
import type { DataEnvironment } from "@/lib/pursuits/lineage";

/**
 * INTAKE LINEAGE AND REVERSAL (Slice 2).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `commitImportBatch` ended in `delete from import_rows where batch_id = $1`. The instant an import
 * succeeded, the only surviving record of what it had done was three integer counts — so a bad
 * upload could not be explained, audited or undone without an engineer at a SQL prompt. A pilot in
 * which the owner cannot reverse their own mistake is not a pilot.
 *
 * ── WHAT REVERSAL MEANS, AND WHAT IT REFUSES TO MEAN ────────────────────────────────────────────
 *
 * Reversal COMPENSATES the organization-scoped effects of a batch. It does not erase history: the
 * batch row, its effects and the disposition of every reversal attempt all survive. "Make the counts
 * go back to zero" is not the goal and would destroy the evidence that the import happened.
 *
 * ── THE GLOBAL IDENTITY GRAPH IS APPEND-ONLY (owner ruling) ─────────────────────────────────────
 *
 * `companies` and `company_aliases` carry no `org_id` — they are shared identity infrastructure, not
 * the importing organization's property merely because its batch created the row first. So reversal
 * NEVER deletes or rewrites them, and it does not reason about whether anyone else is using them:
 * reference counting as a deletion permission is a cross-org read whose answer can change between
 * the check and the delete. They are reported as retained, not hidden.
 *
 * ── CONFLICT IS AN OUTCOME, NOT A FAILURE ───────────────────────────────────────────────────────
 *
 * Every update this intake performs is fill-only (`coalesce(existing, new)`), so the before-state is
 * STRUCTURALLY NULL and is not stored — storing it would be storing a constant. What is stored is
 * the value the batch WROTE, and reversal restores NULL only while the current value still equals
 * it. If a person has since changed that field, the later work wins and the disposition is
 * ROLLBACK_CONFLICT. Silently overwriting someone's correction to make an import disappear is worse
 * than leaving the import in place.
 */

export type BatchEffect =
  | "GLOBAL_IDENTITY_RETAINED"
  | "CREATED_REVERSIBLE"
  | "MATCHED_PREEXISTING"
  | "UPDATED_REVERSIBLE"
  | "NO_CHANGE";

export type SubjectKind =
  | "company" | "company_alias" | "contact" | "opportunity" | "crm_snapshot"
  | "evidence" | "partner_account" | "account_population" | "population_member";

export type Disposition =
  | "REVERSED" | "RETAINED_GLOBAL" | "RETAINED_MATCHED" | "ROLLBACK_CONFLICT" | "RETAINED_REFERENCED";

/** The subject kinds that live in the shared identity graph and are never reversed. */
export const GLOBAL_IDENTITY_KINDS: SubjectKind[] = ["company", "company_alias"];

export interface EffectInput {
  orgId: string;
  batchId: string;
  sourceRowNo?: number | null;
  subjectKind: SubjectKind;
  subjectId: string;
  effect: BatchEffect;
  /** Only the values this batch WROTE, and only where a later conflict could arise. */
  fieldsWritten?: Record<string, unknown> | null;
  dataEnvironment?: DataEnvironment | null;
}

/** Append one batch effect. Assumes the caller's transaction. */
export async function recordEffect(db: PoolClient, e: EffectInput): Promise<void> {
  await db.query(
    `insert into import_batch_effects
       (org_id, batch_id, source_row_no, subject_kind, subject_id, effect, fields_written, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.orgId, e.batchId, e.sourceRowNo ?? null, e.subjectKind, e.subjectId, e.effect,
     e.fieldsWritten ? JSON.stringify(e.fieldsWritten) : null, e.dataEnvironment ?? null]);
}

/**
 * What still depends on an org-scoped row, so reversal can decline rather than break it.
 *
 * DELIBERATELY NARROW AND EXPLICIT. Each entry names the downstream relationships that constitute
 * real business activity on that subject — not every foreign key that happens to exist. A row a
 * person has since worked is not import residue any more, whoever created it.
 */
const REFERENCE_CHECKS: Partial<Record<SubjectKind, { sql: string; why: string }[]>> = {
  opportunity: [
    { sql: `select 1 from opportunities where id = $1 and pursuit_id is not null`, why: "it is linked to a pursuit" },
    { sql: `select 1 from opportunity_stage_transitions where opportunity_id = $1 and from_stage is not null`, why: "its stage has been moved since" },
    { sql: `select 1 from change_ledger where entity_type = 'opportunity' and entity_id = $1`, why: "it has commercial history on the ledger" },
    { sql: `select 1 from stakeholders where opportunity_id = $1`, why: "stakeholders have been mapped on it" },
  ],
  contact: [
    { sql: `select 1 from message_participants where contact_id = $1`, why: "it appears in a conversation" },
    { sql: `select 1 from stakeholders where contact_id = $1`, why: "it is a mapped stakeholder" },
  ],
  evidence: [
    { sql: `select 1 from fact_evidence where evidence_id = $1`, why: "a fact rests on it" },
  ],
};

/** The org-scoped delete for each reversible kind. Global kinds are absent by design. */
const DELETES: Partial<Record<SubjectKind, string>> = {
  contact: `delete from contacts where id = $1 and org_id = $2`,
  opportunity: `delete from opportunities where id = $1 and org_id = $2`,
  crm_snapshot: `delete from crm_snapshots where id = $1 and org_id = $2`,
  evidence: `delete from evidence where id = $1 and org_id = $2`,
  partner_account: `delete from partner_accounts where id = $1 and org_id = $2`,
  account_population: `delete from account_populations where id = $1 and org_id = $2`,
  population_member: `delete from population_members where population_id = $1`,
};

/** The fill-only restore for each updatable kind: back to NULL, and only while unchanged. */
const RESTORE_TABLE: Partial<Record<SubjectKind, { table: string; orgScoped: boolean }>> = {
  contact: { table: "contacts", orgScoped: true },
  partner_account: { table: "partner_accounts", orgScoped: true },
};

export interface ReversalOutcome {
  batchId: string;
  reversed: number;
  retainedGlobal: number;
  retainedMatched: number;
  retainedReferenced: number;
  conflicts: number;
  alreadyReversed: boolean;
}

/**
 * Reverse a committed batch. Idempotent: a second call finds the batch already reversed and writes
 * nothing further.
 *
 * Runs inside the caller's transaction, and each risky compensation runs behind a SAVEPOINT — a
 * delete refused by a foreign key must become a disposition, not an aborted transaction that loses
 * every other compensation in the batch. (The lesson `dispatchSkill` already learned.)
 */
export async function reverseBatch(
  db: PoolClient, args: { orgId: string; batchId: string; userId?: string | null },
): Promise<ReversalOutcome> {
  const { rows: batchRows } = await db.query<{ id: string; status: string; reversed_at: Date | null }>(
    `select id, status, reversed_at from import_batches where id = $1 and org_id = $2`,
    [args.batchId, args.orgId]);
  const batch = batchRows[0];
  if (!batch) throw new Error("Import not found (or it belongs to another organization).");
  if (batch.status !== "imported") throw new Error(`Only a committed import can be reversed (this one is ${batch.status}).`);
  const out: ReversalOutcome = { batchId: args.batchId, reversed: 0, retainedGlobal: 0, retainedMatched: 0, retainedReferenced: 0, conflicts: 0, alreadyReversed: false };
  if (batch.reversed_at) {
    out.alreadyReversed = true;
    const { rows } = await db.query<{ disposition: string; n: string }>(
      `select disposition, count(*)::text n from import_batch_reversals where batch_id = $1 and org_id = $2 group by 1`,
      [args.batchId, args.orgId]);
    for (const r of rows) tally(out, r.disposition as Disposition, Number(r.n));
    return out;
  }

  // Newest effects first: a population member must go before the population it belongs to, and a
  // row created late in a batch may depend on one created early in it.
  const { rows: effects } = await db.query<{
    id: string; subject_kind: SubjectKind; subject_id: string; effect: BatchEffect; fields_written: Record<string, unknown> | null;
  }>(`select id, subject_kind, subject_id, effect, fields_written
        from import_batch_effects where batch_id = $1 and org_id = $2
       order by recorded_at desc, id desc`, [args.batchId, args.orgId]);

  for (const e of effects) {
    const put = async (d: Disposition, reason: string, detail?: unknown) => {
      await db.query(
        `insert into import_batch_reversals (org_id, batch_id, effect_id, disposition, reason, detail)
         values ($1,$2,$3,$4,$5,$6)`,
        [args.orgId, args.batchId, e.id, d, reason, detail === undefined ? null : JSON.stringify(detail)]);
      tally(out, d, 1);
    };

    // 1. The shared identity graph, by rule. No reference counting, no condition.
    if (GLOBAL_IDENTITY_KINDS.includes(e.subject_kind) || e.effect === "GLOBAL_IDENTITY_RETAINED") {
      await put("RETAINED_GLOBAL", "shared identity infrastructure is append-only and is not owned by the importing organization");
      continue;
    }
    // 2. It existed before the batch. Reversing an import must not delete what the import found.
    if (e.effect === "MATCHED_PREEXISTING") { await put("RETAINED_MATCHED", "this object pre-existed the batch"); continue; }
    if (e.effect === "NO_CHANGE") { await put("RETAINED_MATCHED", "the batch changed nothing about this object"); continue; }

    // 3. A fill-only update: restore NULL, and ONLY while the current value is still the one the
    //    batch wrote. Anything else means a person has been here since.
    if (e.effect === "UPDATED_REVERSIBLE") {
      const target = RESTORE_TABLE[e.subject_kind];
      const fields = Object.keys(e.fields_written ?? {});
      if (!target || fields.length === 0) { await put("ROLLBACK_CONFLICT", "no restorable field was captured for this update"); continue; }
      const conflicting: string[] = [];
      const restorable: string[] = [];
      for (const f of fields) {
        const { rows } = await db.query<{ same: boolean }>(
          `select (${quoteIdent(f)} is not distinct from $2) as same from ${quoteIdent(target.table)} where id = $1`,
          [e.subject_id, e.fields_written![f] as never]);
        if (!rows[0]) { conflicting.push(f); continue; }          // the row itself is gone
        (rows[0].same ? restorable : conflicting).push(f);
      }
      if (conflicting.length) {
        await put("ROLLBACK_CONFLICT", "the value changed after the import; the later work was kept", { conflicting, restorable });
        continue;
      }
      await db.query(
        `update ${quoteIdent(target.table)} set ${restorable.map((f, i) => `${quoteIdent(f)} = null${i < restorable.length - 1 ? "," : ""}`).join(" ")}
          where id = $1 and org_id = $2`, [e.subject_id, args.orgId]);
      await put("REVERSED", "fill-only update restored to its original empty state", { fields: restorable });
      continue;
    }

    // 4. Created solely by this batch. Decline if real business activity now rests on it.
    const blocked = await referencedBy(db, e.subject_kind, e.subject_id);
    if (blocked) { await put("RETAINED_REFERENCED", blocked); continue; }
    const del = DELETES[e.subject_kind];
    if (!del) { await put("ROLLBACK_CONFLICT", `no reversal is defined for ${e.subject_kind}`); continue; }
    const sp = `sp_rev_${Math.random().toString(36).slice(2, 10)}`;
    await db.query(`savepoint ${sp}`);
    try {
      const params = e.subject_kind === "population_member" ? [e.subject_id] : [e.subject_id, args.orgId];
      const r = await db.query(del, params);
      await db.query(`release savepoint ${sp}`);
      if ((r.rowCount ?? 0) > 0) await put("REVERSED", "created by this batch and unused since");
      else await put("RETAINED_MATCHED", "the row is already gone — nothing to compensate");
    } catch (err) {
      // A constraint refused it. That IS the answer; it is not a reason to lose the rest.
      await db.query(`rollback to savepoint ${sp}`);
      await db.query(`release savepoint ${sp}`);
      await put("RETAINED_REFERENCED", "the database refused the removal — something still depends on it",
        { error: (err as Error).message.split("\n")[0].slice(0, 160) });
    }
  }

  await db.query(
    `update import_batches
        set reversed_at = now(), reversed_by_user_id = $3, reversal_summary = $4
      where id = $1 and org_id = $2`,
    [args.batchId, args.orgId, args.userId ?? null, JSON.stringify(out)]);
  return out;
}

async function referencedBy(db: PoolClient, kind: SubjectKind, id: string): Promise<string | null> {
  for (const check of REFERENCE_CHECKS[kind] ?? []) {
    const { rows } = await db.query(check.sql, [id]);
    if (rows[0]) return check.why;
  }
  return null;
}

function tally(out: ReversalOutcome, d: Disposition, n: number) {
  if (d === "REVERSED") out.reversed += n;
  else if (d === "RETAINED_GLOBAL") out.retainedGlobal += n;
  else if (d === "RETAINED_MATCHED") out.retainedMatched += n;
  else if (d === "RETAINED_REFERENCED") out.retainedReferenced += n;
  else out.conflicts += n;
}

/**
 * Identifiers reach SQL by interpolation here, so they are constrained to the shape an identifier
 * can have. Every value that reaches these statements is a bound parameter; only column and table
 * NAMES are interpolated, and they come from the two maps above rather than from any input.
 */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`refusing an unsafe identifier: ${name}`);
  return `"${name}"`;
}
