"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import {
  addPursuitNote,
  brokerPropose,
  closeJointPursuit,
  decideJointPursuit,
  proposeJointPursuit,
} from "@/lib/partnerships/joint";

/**
 * Joint pursuit actions (task #74). Working a pursuit is operator-level
 * (requireWrite) — the heavy consent (which accounts both sides may even
 * discuss) already happened on the blind-overlap ladder, owner-approved.
 */

async function writerOrg(): Promise<{ pool: ReturnType<typeof getPool>; orgId: string }> {
  const pool = getPool();
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  return { pool, orgId };
}

export async function proposePursuitAction(formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  const partnershipId = String(formData.get("partnershipId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!partnershipId || !companyId) throw new Error("Pick a partnership and an account.");
  const pursuitId = await proposeJointPursuit(pool, orgId, partnershipId, companyId);
  revalidatePath("/joint");
  redirect(`/joint/${pursuitId}`);
}

export async function decidePursuitAction(pursuitId: string, accept: boolean): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await decideJointPursuit(pool, orgId, pursuitId, accept);
  revalidatePath("/joint");
  revalidatePath(`/joint/${pursuitId}`);
}

export async function closePursuitAction(pursuitId: string): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await closeJointPursuit(pool, orgId, pursuitId);
  revalidatePath("/joint");
  revalidatePath(`/joint/${pursuitId}`);
}

export async function addNoteAction(pursuitId: string, formData: FormData): Promise<void> {
  const { pool, orgId } = await writerOrg();
  await addPursuitNote(pool, orgId, pursuitId, String(formData.get("body") ?? ""));
  revalidatePath(`/joint/${pursuitId}`);
}

export async function refreshBrokerAction(pursuitId: string): Promise<void> {
  const { pool } = await writerOrg();
  await brokerPropose(pool, pursuitId);
  revalidatePath(`/joint/${pursuitId}`);
}
