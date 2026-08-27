"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import {
  addPursuitNote,
  brokerPropose,
  closeJointPursuit,
  decideJointPursuit,
  proposeJointPursuit,
} from "@/lib/partnerships/joint";
import { saveJointPlaybook } from "@/lib/playbooks/playbooks";

/**
 * Joint pursuit actions (task #74). Working a pursuit is operator-level
 * (requireWrite) — the heavy consent (which accounts both sides may even
 * discuss) already happened on the blind-overlap ladder, owner-approved.
 */

export async function proposePursuitAction(formData: FormData): Promise<void> {
  const partnershipId = String(formData.get("partnershipId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!partnershipId || !companyId) throw new Error("Pick a partnership and an account.");
  const pursuitId = await withTenant(async (db, orgId) => {
    await requireWrite(db);
    return proposeJointPursuit(db, orgId, partnershipId, companyId);
  });
  revalidatePath("/joint");
  redirect(`/joint/${pursuitId}`);
}

export async function decidePursuitAction(pursuitId: string, accept: boolean): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await decideJointPursuit(db, orgId, pursuitId, accept);
  });
  revalidatePath("/joint");
  revalidatePath(`/joint/${pursuitId}`);
  // Next-step pull (#79): accepting fires the broker — its play is waiting in the room.
  if (accept) redirect(`/joint?accepted=${pursuitId}`);
}

export async function closePursuitAction(pursuitId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await closeJointPursuit(db, orgId, pursuitId);
  });
  revalidatePath("/joint");
  revalidatePath(`/joint/${pursuitId}`);
}

export async function addNoteAction(pursuitId: string, formData: FormData): Promise<void> {
  const body = String(formData.get("body") ?? "");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await addPursuitNote(db, orgId, pursuitId, body);
  });
  revalidatePath(`/joint/${pursuitId}`);
}

/** Joint playbook (task #83): one shared body per partnership — both sides edit the identical text, every save audited on both ledgers. */
export async function saveJointPlaybookAction(pursuitId: string, partnershipId: string, formData: FormData): Promise<void> {
  const body = String(formData.get("body") ?? "");
  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    await saveJointPlaybook(db, orgId, partnershipId, body);
  });
  revalidatePath(`/joint/${pursuitId}`);
}

export async function refreshBrokerAction(pursuitId: string): Promise<void> {
  await withTenant(async (db) => {
    await requireWrite(db);
    await brokerPropose(db, pursuitId);
  });
  revalidatePath(`/joint/${pursuitId}`);
}
