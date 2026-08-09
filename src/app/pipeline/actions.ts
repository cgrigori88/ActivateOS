"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import {
  advanceOpportunity,
  createOpportunityFromMotion,
  type Stage,
} from "@/lib/opportunities/lifecycle";

export async function advanceOpportunityAction(
  opportunityId: string,
  to: Stage,
): Promise<void> {
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

export async function setStakeholderAction(
  opportunityId: string,
  contactId: string,
  formData: FormData,
): Promise<void> {
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
