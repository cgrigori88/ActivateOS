"use server";

import { revalidatePath } from "next/cache";
import { currentRole, requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { opportunityEnvironment } from "@/lib/pursuits/provenance";
import { dispatchSkill } from "@/lib/pursuits/federation/skills";
import { assignInitiative } from "@/lib/partnerships/initiatives";
import { decideWriteback, draftWritebacks } from "@/lib/opportunities/writeback";
import {
  advanceOpportunity,
  createOpportunityFromMotion,
  type Stage,
} from "@/lib/opportunities/lifecycle";
import { assessMeddpicc, upsertElement, type ElementKey, type Status } from "@/lib/opportunities/meddpicc";

// RISK-1 (task #67): every DB touch runs inside withTenant, which pins the
// session to the caller's org (app.org_id). requireWrite runs inside so its
// membership lookup is visible under the GUC; revalidate stays outside (after
// commit). Inert on the owner connection; under app_rw the by-id writes here
// (deal_registrations / stakeholders / meddpicc) auto-scope to the org via RLS
// — the DB belt behind the app-layer checks.

/** Set one MEDDPICC element (status + notes) on an opportunity. */
export async function setMeddpiccAction(opportunityId: string, element: ElementKey, formData: FormData): Promise<void> {
  const status = String(formData.get("status") ?? "unknown") as Status;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await upsertElement(db, orgId, { opportunityId, element, status, notes, source: "human", updatedBy: "web" });
  });
  revalidatePath("/pipeline");
}

/** Draft a full MEDDPICC assessment from the account's evidence & stakeholders. */
export async function assessMeddpiccAction(opportunityId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await assessMeddpicc(db, orgId, opportunityId);
  });
  revalidatePath("/pipeline");
}

export async function advanceOpportunityAction(
  opportunityId: string,
  to: Stage,
): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await advanceOpportunity(db, orgId, opportunityId, to);
  });
  revalidatePath("/pipeline");
}

export async function promoteMotionAction(motionId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    await createOpportunityFromMotion(db, orgId, motionId);
  });
  revalidatePath("/pipeline");
  revalidatePath(`/briefs/${motionId}`);
}

/** Register a co-sell deal on an opportunity (Phase 9E). */
export async function registerDealAction(opportunityId: string, formData: FormData): Promise<void> {
  const vendor = String(formData.get("vendor") ?? "").trim() || null;
  const product = String(formData.get("product") ?? "").trim() || null;
  const protectDays = Number(formData.get("protectDays") ?? 90) || 90;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    const { rows } = await db.query<{
      company_id: string;
      motion_id: string | null;
      amount_usd: string | null;
      partner_id: string | null;
    }>(
      `select o.company_id, o.motion_id, o.amount_usd, m.partner_id
       from opportunities o left join revenue_motions m on m.id = o.motion_id and m.org_id = o.org_id
       where o.id = $1 and o.org_id = $2`,
      [opportunityId, orgId],
    );
    if (rows.length === 0) throw new Error("opportunity not found");
    const o = rows[0];
    await db.query(
      `insert into deal_registrations
        (org_id, opportunity_id, company_id, motion_id, partner_id, vendor, product,
         amount_usd, status, submitted_at, protected_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', now(), (now() + make_interval(days => $9))::date)`,
      [orgId, opportunityId, o.company_id, o.motion_id, o.partner_id, vendor, product, o.amount_usd, protectDays],
    );
  });
  revalidatePath("/pipeline");
}

/** Advance a registration's status (submitted → approved/rejected/expired). */
export async function setRegistrationStatusAction(registrationId: string, status: string): Promise<void> {
  const allowed = ["submitted", "approved", "rejected", "expired"];
  if (!allowed.includes(status)) throw new Error("invalid status");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    const res = await db.query(
      `update deal_registrations
         set status = $2, decided_at = case when $2 in ('approved','rejected') then now() else decided_at end,
             updated_at = now()
       where id = $1 and org_id = $3`,
      [registrationId, status, orgId],
    );
    if ((res.rowCount ?? 0) === 0) throw new Error("registration not found");
  });
  revalidatePath("/pipeline");
}

export async function setStakeholderAction(
  opportunityId: string,
  contactId: string,
  formData: FormData,
): Promise<void> {
  const role = String(formData.get("role") ?? "influencer");
  const sentiment = String(formData.get("sentiment") ?? "unknown");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);  // viewers are read-only (multi-tenant slice 3)
    // Sentiment is an observation, freely editable. The ROLE is an authoritative buying-role
    // assertion (P1C): it flows through the governed skill only — a bare pipeline edit carries no
    // evidence, so it lands as an honest `unverified` assertion (verification happens on the
    // Pursuit's stakeholder panel, with evidence). The 0097 trigger makes the old direct role
    // UPDATE an error, not a convention.
    // stakeholders has no org_id: gate on the opportunity belonging to the caller's org.
    const owned = await db.query(`select 1 from opportunities where id = $1 and org_id = $2`, [opportunityId, orgId]);
    if (owned.rows.length === 0) throw new Error("opportunity not found");
    await db.query(
      `update stakeholders s set sentiment = $3
         from opportunities o
        where o.id = s.opportunity_id and o.org_id = $4
          and s.opportunity_id = $1 and s.contact_id = $2`,
      [opportunityId, contactId, sentiment, orgId],
    );
    const current = (await db.query<{ role: string }>(
      `select role from stakeholders where opportunity_id = $1 and contact_id = $2`, [opportunityId, contactId])).rows[0];
    if (current && current.role !== role) {
      const roleName = await currentRole(db);
      // The stakeholder belongs to an opportunity, which belongs (or does not) to a pursuit — so the
      // pursuit is the subject that carries provenance. An opportunity with no pursuit yields none,
      // and the role assertion is skipped rather than recorded as production activity: the sentiment
      // update above has already been applied, and inventing an environment for the audit row would
      // be worse than not writing one.
      const env = await opportunityEnvironment(db, orgId, opportunityId);
      if (env) {
        await dispatchSkill(db, "assert_stakeholder_role", { type: "USER", id: null, orgId, role: roleName }, {
          args: { opportunityId, contactId, role, assertionState: "unverified", source: "human:pipeline" },
          dataEnvironment: env,
        });
      }
    }
  });
  revalidatePath("/pipeline");
}

/** Attach an opportunity to an initiative (task #83) — or detach with "". */
export async function assignInitiativeAction(opportunityId: string, formData: FormData): Promise<void> {
  const initiativeId = String(formData.get("initiativeId") ?? "") || null;
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await assignInitiative(db, orgId, "opportunity", opportunityId, initiativeId);
  });
  revalidatePath("/pipeline");
  revalidatePath("/partners");
}

/** Draft CRM correction proposals from the current tie-out (slice A). */
export async function draftWritebacksAction(): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await draftWritebacks(db, orgId);
  });
  revalidatePath("/pipeline");
}

export async function decideWritebackAction(id: string, status: "approved" | "dismissed"): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await decideWriteback(db, orgId, id, status);
  });
  revalidatePath("/pipeline");
}
