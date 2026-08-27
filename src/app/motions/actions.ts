"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { approveMotion, rejectMotion } from "@/lib/motions/approve";
import { transitionMotion, type MotionOutcome } from "@/lib/motions/lifecycle";
import { designMotion } from "@/lib/agents/motion-designer";
import { suppressedCompanyIds } from "@/lib/icp/icp";
import { assignInitiative } from "@/lib/partnerships/initiatives";

// Single-taxonomy v1, same slug Mapping drafts against.
const MOTION_TARGET_SLUG = "infrastructure-automation";
/** AI drafts per run — honest batching instead of a job queue (task #83). */
const DRAFT_BATCH = 10;

/**
 * Draft motions from the Motions room (task #83): the target is either a
 * whole approved list (populationId) or a picked set of accounts
 * (companyIds checkboxes). Accounts that already carry an open motion are
 * skipped; the rest are ranked by propensity and drafted in batches of
 * DRAFT_BATCH — run again for the next batch. Every draft is the same
 * evidence-grounded agent Mapping uses; nothing is hand-invented.
 */
export async function draftMotionsAction(formData: FormData): Promise<void> {
  const populationId = String(formData.get("populationId") ?? "").trim();
  const picked = formData.getAll("companyIds").map(String).filter(Boolean).slice(0, 200);

  let ok = 0;
  let fail = 0;
  let skipped = 0; // already carry an open motion
  let blocked = 0; // on the suppression list — the machine may not pursue them
  let more = 0; // ready but beyond this run's batch
  let errNotice: string | null = null;
  try {
    await withTenant(async (db, orgId) => {
      await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)

      let candidates: string[] = picked;
      if (populationId) {
        const { rows: pop } = await db.query(
          `select 1 from account_populations where id = $1 and org_id = $2 and status = 'approved'`,
          [populationId, orgId],
        );
        if (!pop[0]) throw new Error("That list isn't one of your approved lists.");
        const { rows } = await db.query<{ company_id: string }>(
          `select company_id from population_members where population_id = $1`,
          [populationId],
        );
        candidates = rows.map((r) => r.company_id);
      }

      if (candidates.length > 0) {
        const { rows: open } = await db.query<{ company_id: string }>(
          `select distinct company_id from revenue_motions
           where company_id = any($1) and status in ('draft', 'approved', 'active')`,
          [candidates],
        );
        const openSet = new Set(open.map((r) => r.company_id));
        skipped = candidates.filter((c) => openSet.has(c)).length;
        let ready = candidates.filter((c) => !openSet.has(c));

        // Hard guardrail (ICP slice, task #83): suppressed accounts never enter
        // a draft run, whatever the scores say.
        const suppressed = await suppressedCompanyIds(db, orgId, ready);
        blocked = ready.filter((c) => suppressed.has(c)).length;
        ready = ready.filter((c) => !suppressed.has(c));

        // Highest propensity first; unscored accounts sort last (they'd fail
        // the designer's score gate anyway, so the batch spends itself well).
        const { rows: scores } = await db.query<{ company_id: string; score: string }>(
          `select distinct on (company_id) company_id, score from propensity_scores
           where company_id = any($1) order by company_id, computed_at desc`,
          [ready],
        );
        const scoreOf = new Map(scores.map((r) => [r.company_id, Number(r.score)]));
        ready.sort((a, b) => (scoreOf.get(b) ?? -1) - (scoreOf.get(a) ?? -1));
        more = Math.max(0, ready.length - DRAFT_BATCH);

        for (const companyId of ready.slice(0, DRAFT_BATCH)) {
          try {
            await designMotion(db, { orgId, companyId, targetSlug: MOTION_TARGET_SLUG });
            ok++;
          } catch {
            fail++;
          }
        }
      }
    });
  } catch (err) {
    // A bad selection is a notice, never a crash screen.
    errNotice = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/motions");
  if (errNotice) redirect(`/motions?notice=${encodeURIComponent(errNotice)}`);
  redirect(`/motions?status=draft&drafted=${ok}&failed=${fail}&skipped=${skipped}&blocked=${blocked}&more=${more}`);
}

/**
 * One account, from its room (wires the path that existed server-side but
 * never had a button). Success lands on the fresh brief; failure returns to
 * the account with the reason.
 */
export async function draftAccountMotionAction(companyId: string): Promise<void> {
  let motionId: string | null = null;
  let reason: string | null = null;
  try {
    motionId = await withTenant(async (db, orgId) => {
      await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
      const suppressed = await suppressedCompanyIds(db, orgId, [companyId]);
      if (suppressed.has(companyId)) {
        throw new Error("This account is on your suppression list — remove it on Admin first if that's wrong.");
      }
      const res = await designMotion(db, { orgId, companyId, targetSlug: MOTION_TARGET_SLUG });
      return res.motionId;
    });
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/motions");
  redirect(
    motionId
      ? `/briefs/${motionId}`
      : `/accounts/${companyId}?notice=${encodeURIComponent(`Couldn't draft a motion: ${reason ?? "unknown error"}`)}`,
  );
}

/** Link (or unlink) a motion to a S.M.A.R.T. goal so its value rolls up. */
export async function setMotionGoalAction(motionId: string, formData: FormData): Promise<void> {
  const goalId = String(formData.get("goalId") ?? "").trim() || null;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // FLOW-1 fix: org-scoped so a foreign motion id can't be retargeted.
    await db.query(`update revenue_motions set goal_id = $2 where id = $1 and org_id = $3`, [motionId, goalId, orgId]);
  });
  revalidatePath("/motions");
  revalidatePath("/goals");
}

/** Attach this motion to an initiative (task #83 follow-up) — or detach with "". */
export async function setMotionInitiativeAction(motionId: string, formData: FormData): Promise<void> {
  const initiativeId = String(formData.get("initiativeId") ?? "").trim() || null;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await assignInitiative(db, orgId, "motion", motionId, initiativeId);
  });
  revalidatePath("/motions");
  revalidatePath("/partners");
}

export async function approveMotionAction(motionId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await approveMotion(db, motionId);
  });
  revalidatePath("/motions");
  // Next-step pull (#79): an approved play's natural next room is the composer.
  redirect(`/motions?approved=${motionId}`);
}

export async function rejectMotionAction(motionId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await rejectMotion(db, motionId);
  });
  revalidatePath("/motions");
}

export async function activateMotionAction(motionId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await transitionMotion(db, motionId, "active");
  });
  revalidatePath("/motions");
}

export async function completeMotionAction(
  motionId: string,
  outcome: MotionOutcome,
): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await transitionMotion(db, motionId, "completed", { outcome });
  });
  revalidatePath("/motions");
}

export async function abandonMotionAction(motionId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await transitionMotion(db, motionId, "abandoned");
  });
  revalidatePath("/motions");
}

/**
 * Edit a motion's narrative fields + operator notes. Notes are the human->AI
 * channel: they ride into the campaign generator's grounding, so what the
 * operator writes here steers every future draft for this motion.
 */
export async function editMotionAction(motionId: string, formData: FormData): Promise<void> {
  const thesis = String(formData.get("thesis") ?? "").trim() || null;
  const trigger = String(formData.get("trigger") ?? "").trim() || null;
  const cta = String(formData.get("cta") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await withTenant(async (db) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await db.query(
      `update revenue_motions set thesis = coalesce($2, thesis), trigger_summary = coalesce($3, trigger_summary),
         cta = coalesce($4, cta), operator_notes = $5
       where id = $1`,
      [motionId, thesis, trigger, cta, notes],
    );
  });
  revalidatePath("/motions");
}
