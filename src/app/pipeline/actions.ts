"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { assignInitiative } from "@/lib/partnerships/initiatives";
import { decideWriteback, draftWritebacks } from "@/lib/opportunities/writeback";
import {
  advanceOpportunity,
  createOpportunityFromMotion,
  type Stage,
} from "@/lib/opportunities/lifecycle";
import { assessMeddpicc, upsertElement, type ElementKey, type Status } from "@/lib/opportunities/meddpicc";

/** Set one MEDDPICC element (status + notes) on an opportunity. */
export async function setMeddpiccAction(opportunityId: string, element: ElementKey, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const status = String(formData.get("status") ?? "unknown") as Status;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const pool = getPool();
  await upsertElement(pool, { opportunityId, element, status, notes, source: "human", updatedBy: "web" });
  revalidatePath("/pipeline");
}

/** Draft a full MEDDPICC assessment from the account's evidence & stakeholders. */
export async function assessMeddpiccAction(opportunityId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await assessMeddpicc(db, opportunityId);
  } finally {
    db.release();
  }
  revalidatePath("/pipeline");
}

export async function advanceOpportunityAction(
  opportunityId: string,
  to: Stage,
): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await advanceOpportunity(db, opportunityId, to);
  } finally {
    db.release();
  }
  revalidatePath("/pipeline");
}

export async function promoteMotionAction(motionId: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const pool = getPool();
  const db = await pool.connect();
  try {
    await createOpportunityFromMotion(db, motionId);
  } finally {
    db.release();
  }
  revalidatePath("/pipeline");
  revalidatePath(`/briefs/${motionId}`);
}

/** Register a co-sell deal on an opportunity (Phase 9E). */
export async function registerDealAction(opportunityId: string, formData: FormData): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const vendor = String(formData.get("vendor") ?? "").trim() || null;
  const product = String(formData.get("product") ?? "").trim() || null;
  const protectDays = Number(formData.get("protectDays") ?? 90) || 90;
  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows } = await db.query<{
      org_id: string | null;
      company_id: string;
      motion_id: string | null;
      amount_usd: string | null;
      partner_id: string | null;
    }>(
      `select o.org_id, o.company_id, o.motion_id, o.amount_usd, m.partner_id
       from opportunities o left join revenue_motions m on m.id = o.motion_id
       where o.id = $1`,
      [opportunityId],
    );
    if (rows.length === 0) throw new Error("opportunity not found");
    const o = rows[0];
    await db.query(
      `insert into deal_registrations
        (org_id, opportunity_id, company_id, motion_id, partner_id, vendor, product,
         amount_usd, status, submitted_at, protected_until)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', now(), (now() + make_interval(days => $9))::date)`,
      [o.org_id, opportunityId, o.company_id, o.motion_id, o.partner_id, vendor, product, o.amount_usd, protectDays],
    );
  } finally {
    db.release();
  }
  revalidatePath("/pipeline");
}

/** Advance a registration's status (submitted → approved/rejected/expired). */
export async function setRegistrationStatusAction(registrationId: string, status: string): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const allowed = ["submitted", "approved", "rejected", "expired"];
  if (!allowed.includes(status)) throw new Error("invalid status");
  const pool = getPool();
  await pool.query(
    `update deal_registrations
       set status = $2, decided_at = case when $2 in ('approved','rejected') then now() else decided_at end,
           updated_at = now()
     where id = $1`,
    [registrationId, status],
  );
  revalidatePath("/pipeline");
}

export async function setStakeholderAction(
  opportunityId: string,
  contactId: string,
  formData: FormData,
): Promise<void> {
  await requireWrite(getPool());  // viewers are read-only (multi-tenant slice 3)
  const role = String(formData.get("role") ?? "influencer");
  const sentiment = String(formData.get("sentiment") ?? "unknown");
  const pool = getPool();
  const db = await pool.connect();
  try {
    await db.query(
      `update stakeholders set role = $3, sentiment = $4
       where opportunity_id = $1 and contact_id = $2`,
      [opportunityId, contactId, role, sentiment],
    );
  } finally {
    db.release();
  }
  revalidatePath("/pipeline");
}

/** Attach an opportunity to an initiative (task #83) — or detach with "". */
export async function assignInitiativeAction(opportunityId: string, formData: FormData): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const initiativeId = String(formData.get("initiativeId") ?? "") || null;
  await assignInitiative(pool, orgId, "opportunity", opportunityId, initiativeId);
  revalidatePath("/pipeline");
  revalidatePath("/partners");
}

/** Draft CRM correction proposals from the current tie-out (slice A). */
export async function draftWritebacksAction(): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  await draftWritebacks(pool, orgId);
  revalidatePath("/pipeline");
}

export async function decideWritebackAction(id: string, status: "approved" | "dismissed"): Promise<void> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  await decideWriteback(pool, orgId, id, status);
  revalidatePath("/pipeline");
}
