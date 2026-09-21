import type { PoolClient } from "pg";
import { upsertPursuit } from "@/lib/pursuits/model";
import { createMotionActions } from "./cadence";
import { evaluateMotions, loadMotionTemplates, type MotionFit } from "./eligibility";
import type { MotionTemplate } from "./template";
import type { DataEnvironment } from "@/lib/pursuits/lineage";

/**
 * APPLYING A REUSABLE COMMERCIAL MOTION (thin P9).
 *
 * ── THIS COMPOSES; IT DOES NOT INVENT ───────────────────────────────────────────────────────────
 *
 * Every structure below already existed. `upsertPursuit` already dedupes a pursuit by account,
 * product category, type and use case. `revenue_motions` already carries `play_template_id`, so the
 * exact template VERSION applied is recorded by pointing at the row that is unique on
 * `(slug, version)`. `createMotionActions` already instantiates the template's own cadence,
 * idempotently, on `(motion_id, step)`. And `recordPlanRecommendation` already produces the goal,
 * the plan and a RECOMMENDATION revision through P3 — which is why thin P9 adds no second
 * recommendation system and no second decision boundary.
 *
 * What this function adds is the ACT: a person chose this pattern, for this subject, at this moment,
 * on this evidence.
 *
 * ── IT CREATES A PROPOSAL, NOT A COMMITMENT ─────────────────────────────────────────────────────
 *
 * Nothing here approves a plan, sends anything, reaches a provider, or grants authority. The
 * resulting plan revision is a RECOMMENDATION; a person still decides it through the existing
 * `decide_pursuit_plan` path, and that decision remains distinguishable from what the template
 * proposed — which is the whole reason to reuse P3 rather than write a parallel path.
 *
 * ── ELIGIBILITY RECOMMENDS; IT DOES NOT ACT ─────────────────────────────────────────────────────
 *
 * A NOT_ELIGIBLE subject is refused: the machine has a definite negative and overriding it is a
 * different feature with a different conversation. INSUFFICIENT_CONTEXT is allowed through, because
 * "we cannot tell" is not a reason to stop a person who can.
 */

export interface ApplyMotionInput {
  orgId: string;
  slug: string;
  subjectKind: "company" | "opportunity" | "pursuit";
  subjectId: string;
  appliedByUserId: string | null;
  dataEnvironment: DataEnvironment;
  now?: Date;
}

export interface ApplyMotionResult {
  status: "APPLIED" | "ALREADY_APPLIED" | "REFUSED";
  reason?: string;
  applicationId?: string;
  pursuitId?: string;
  motionId?: string;
  planRevisionId?: string | null;
  fit?: MotionFit;
  /** The template version actually applied — recorded by value, not only by pointer. */
  appliedVersion?: number;
}

/** The pursuit type each motion establishes. Existing vocabulary; no enum was added. */
const PURSUIT_TYPE_FOR: Record<string, "EXPANSION" | "COMPETITIVE_DISPLACEMENT" | "NET_NEW"> = {
  "install-base-whitespace-expansion": "EXPANSION",
  "vmware-displacement-datacenter-modernization": "COMPETITIVE_DISPLACEMENT",
  "rhai-nvidia-ai-growth": "NET_NEW",
};

export async function applyMotion(db: PoolClient, input: ApplyMotionInput): Promise<ApplyMotionResult> {
  const now = input.now ?? new Date();
  const templates = await loadMotionTemplates(db);
  const template = templates.find((t) => t.slug === input.slug);
  if (!template) return { status: "REFUSED", reason: `no active motion template "${input.slug}"` };

  const subject = await resolveSubject(db, input.orgId, input.subjectKind, input.subjectId);
  if (!subject) return { status: "REFUSED", reason: "that subject does not exist in this organization" };

  // IDEMPOTENCE, AND THE VERSIONING RULE. The same template VERSION applied twice to the same
  // subject is the same act: the existing application is returned, and nothing is created a second
  // time. A NEWER version is a different act and is allowed to produce a new application — which is
  // what makes a deliberate rerun explicit rather than an accident of double-clicking.
  const { rows: prior } = await db.query<{ id: string; pursuit_id: string | null; motion_id: string | null; plan_revision_id: string | null }>(
    `select id, pursuit_id, motion_id, plan_revision_id from motion_applications
      where org_id = $1 and template_slug = $2 and template_version = $3
        and subject_kind = $4 and subject_id = $5`,
    [input.orgId, template.slug, template.version, input.subjectKind, input.subjectId]);
  if (prior[0]) {
    return { status: "ALREADY_APPLIED", applicationId: prior[0].id, pursuitId: prior[0].pursuit_id ?? undefined,
             motionId: prior[0].motion_id ?? undefined, planRevisionId: prior[0].plan_revision_id, appliedVersion: template.version };
  }

  const fits = await evaluateMotions(db, input.orgId, [template], [subject.companyId], now);
  const fit = (fits.get(subject.companyId) ?? [])[0];
  if (!fit) return { status: "REFUSED", reason: "eligibility could not be evaluated" };
  if (fit.verdict === "NOT_ELIGIBLE") {
    return { status: "REFUSED", reason: "this motion does not apply to this account", fit };
  }
  // INSUFFICIENT_CONTEXT PROCEEDS, AND IS RECORDED AS SUCH. A person may know things the system does
  // not, so they may start the work — but the verdict written below is the one the evaluation
  // produced. Choosing to proceed never promotes it to ELIGIBLE: the missing facts did not become
  // true because somebody pressed a button.

  // 1. THE PURSUIT. Deduped by the existing identity rule, so applying a second motion that targets
  //    the same category and type joins the work already under way instead of forking it.
  const pursuit = subject.pursuitId
    ? { id: subject.pursuitId }
    : await upsertPursuit(db, {
        orgId: input.orgId, accountId: subject.companyId,
        productCategoryId: template.taxonomyNodeId ?? null,
        pursuitType: PURSUIT_TYPE_FOR[template.slug] ?? "OTHER",
        pursuitTypeSource: "HUMAN", pursuitTypeConfidence: "HIGH",
        useCase: template.slug,
        businessProblem: template.motion.objective,
        createdByActorType: "human", createdByActorId: input.appliedByUserId ?? null,
        createdVia: "USER_CREATED",
        dataEnvironment: input.dataEnvironment,
      });

  // 2. THE MOTION INSTANCE, bound to the exact template row — which is unique on (slug, version), so
  //    the applied version is recorded structurally and cannot drift if the template is later edited.
  const { rows: motionRows } = await db.query<{ id: string }>(
    `insert into revenue_motions (org_id, company_id, taxonomy_node_id, play_template_id, pursuit_id,
                                  status, thesis, cta, primary_persona, secondary_persona, activated_at)
     values ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9, now())
     returning id`,
    [input.orgId, subject.companyId, template.taxonomyNodeId, await templateRowId(db, template),
     pursuit.id, template.motion.objective,
     template.motion.campaignGuidance ?? null, (template.motion.expectedRoles ?? [])[0] ?? null,
     (template.motion.expectedRoles ?? [])[1] ?? null]);
  const motionId = motionRows[0].id;

  // 3. THE ORDERED ACTIONS — the template's own cadence, through the existing instantiator.
  await createMotionActions(db, motionId, now);

  // 4. THE RECOMMENDED PLAN, through P3. The recommender already takes the motion as an input, so
  //    the plan it produces is the motion's plan; nothing re-implements planning here. The revision
  //    it writes is a RECOMMENDATION — a person still decides it.
  let planRevisionId: string | null = null;
  const { recordPlanRecommendation } = await import("@/lib/pursuits/coordination/plan-store");
  const rec = await recordPlanRecommendation(
    db, { type: "USER", id: input.appliedByUserId ?? null, orgId: input.orgId }, pursuit.id,
    { env: input.dataEnvironment, correlationId: null, now });
  planRevisionId = rec.revisionId ?? null;

  // 5. THE ACT ITSELF, with the evaluation as it stood. Append-only: what was believed at the moment
  //    of application cannot be edited afterwards to look better.
  const { rows: appRows } = await db.query<{ id: string }>(
    `insert into motion_applications
       (org_id, template_slug, template_version, play_template_id, subject_kind, subject_id,
        pursuit_id, motion_id, plan_revision_id, eligibility, eligibility_basis,
        applied_by_user_id, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id`,
    [input.orgId, template.slug, template.version, await templateRowId(db, template),
     input.subjectKind, input.subjectId, pursuit.id, motionId, planRevisionId,
     fit.verdict,
     /**
      * THE EVALUATION AS IT STOOD, not a pointer to facts that may move.
      *
      * `facts` is `app_rw=arwd`: a decisive fact can later be superseded, corrected or deleted, so
      * storing only ids would leave a historical application resolving to nothing — or to something
      * that now says the opposite. The normalized observed value and its observation timestamp
      * travel with the reference, plus the missing context as it stood, so "why did this look
      * applicable then" survives.
      *
      * References, categories and timestamps only. No evidence prose crosses into this table (P6).
      */
     JSON.stringify({
       clauses: fit.clauses.map((c) => ({
         predicate: c.predicate, op: c.op, satisfied: c.satisfied, because: c.because,
         factIds: c.factIds, observed: c.observed,
       })),
       missingContext: fit.missingContext,
       evaluatedAt: now.toISOString(),
     }),
     input.appliedByUserId, input.dataEnvironment]);

  return { status: "APPLIED", applicationId: appRows[0].id, pursuitId: pursuit.id, motionId,
           planRevisionId, fit, appliedVersion: template.version };
}

async function templateRowId(db: PoolClient, t: MotionTemplate): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select id from play_templates where slug = $1 and version = $2`, [t.slug, t.version]);
  return rows[0]?.id ?? null;
}

/** A motion always resolves to an ACCOUNT; a pursuit or opportunity simply names one. */
async function resolveSubject(
  db: PoolClient, orgId: string, kind: string, id: string,
): Promise<{ companyId: string; pursuitId: string | null } | null> {
  if (kind === "company") {
    const { rows } = await db.query(`select 1 from companies where id = $1`, [id]);
    return rows[0] ? { companyId: id, pursuitId: null } : null;
  }
  if (kind === "pursuit") {
    const { rows } = await db.query<{ account_id: string }>(
      `select account_id from pursuits where id = $1 and org_id = $2`, [id, orgId]);
    return rows[0] ? { companyId: rows[0].account_id, pursuitId: id } : null;
  }
  const { rows } = await db.query<{ company_id: string; pursuit_id: string | null }>(
    `select company_id, pursuit_id from opportunities where id = $1 and org_id = $2`, [id, orgId]);
  return rows[0] ? { companyId: rows[0].company_id, pursuitId: rows[0].pursuit_id } : null;
}
