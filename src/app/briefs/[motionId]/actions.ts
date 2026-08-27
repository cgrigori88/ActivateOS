"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { requireWrite } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { generateOutreachDraft } from "@/lib/agents/email-generator";
import { ensureThread, sendOutbound } from "@/lib/comms/send";

/**
 * Phase 5D approval flow: AI drafts → human reviews/edits → human approves →
 * PursuitOS sends (Mode A) or packages for the seller's own mailbox (Mode B).
 * The untouched AI draft always persists; edits are learning data.
 */

// The motion must belong to the caller's org, never resolved from the row.
async function motionContext(db: PoolClient, orgId: string, motionId: string) {
  const { rows } = await db.query(
    `select m.org_id, m.company_id, m.partner_seller_id, s.name as seller_name
     from revenue_motions m
     left join sellers s on s.id = m.partner_seller_id
     where m.id = $1 and m.org_id = $2`,
    [motionId, orgId],
  );
  if (rows.length === 0) throw new Error("motion not found");
  return rows[0];
}

export async function generateDraftAction(motionId: string): Promise<void> {
  await withTenant(async (db, orgId) => {
    // Security-audit fix: these actions spend AI budget and write drafts, so
    // they carry the same write gate as every other mutating action.
    await requireWrite(db);
    const ctx = await motionContext(db, orgId, motionId);
    const senderName = ctx.seller_name ?? "The PursuitOS Team";
    const draft = await generateOutreachDraft(db, { motionId, senderName });
    const { threadId } = await ensureThread(db, {
      orgId: ctx.org_id,
      companyId: ctx.company_id,
      motionId,
    });
    // One pending draft per thread: replace any prior unsent draft.
    await db.query(
      `delete from messages where thread_id = $1 and direction = 'outbound' and status = 'draft' and from_email = 'pending'`,
      [threadId],
    );
    await db.query(
      `insert into messages (thread_id, direction, from_email, from_name, subject,
          text_body, ai_draft, status)
       values ($1, 'outbound', 'pending', $2, $3, $4, $4, 'draft')`,
      [threadId, senderName, draft.subject, draft.body],
    );
  });
  revalidatePath(`/briefs/${motionId}`);
}

export async function sendDraftAction(motionId: string, formData: FormData): Promise<void> {
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const mode = String(formData.get("mode") ?? "seller_assisted") as
    | "facilitated"
    | "seller_assisted";
  if (!to || !subject || !body) throw new Error("recipient, subject, and body are required");

  await withTenant(async (db, orgId) => {
    await requireWrite(db);
    const ctx = await motionContext(db, orgId, motionId);
    const { threadId } = await ensureThread(db, {
      orgId: ctx.org_id,
      companyId: ctx.company_id,
      motionId,
    });
    const { rows: drafts } = await db.query<{ id: string; ai_draft: string | null }>(
      `select id, ai_draft from messages
       where thread_id = $1 and direction = 'outbound' and status = 'draft'
         and from_email = 'pending'
       order by created_at desc limit 1`,
      [threadId],
    );

    const senderName = ctx.seller_name ?? "The PursuitOS Team";
    await sendOutbound(db, {
      orgId: ctx.org_id,
      companyId: ctx.company_id,
      motionId,
      identity: {
        displayName: senderName,
        localPart: senderName.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") || "team",
      },
      to: [to.toLowerCase()],
      subject,
      body,
      aiDraft: drafts[0]?.ai_draft ?? null,
      sellerId: ctx.partner_seller_id,
      mode,
    });
    if (drafts.length > 0) {
      await db.query(`delete from messages where id = $1`, [drafts[0].id]);
    }
  });
  revalidatePath(`/briefs/${motionId}`);
}
