"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@/db/client";
import { currentOrgId, requireWrite } from "@/lib/auth/org";
import { generateOutreachDraft } from "@/lib/agents/email-generator";
import { ensureThread, sendOutbound } from "@/lib/comms/send";

/**
 * Phase 5D approval flow: AI drafts → human reviews/edits → human approves →
 * PursuitOS sends (Mode A) or packages for the seller's own mailbox (Mode B).
 * The untouched AI draft always persists; edits are learning data.
 */

async function motionContext(motionId: string) {
  const pool = getPool();
  // Security-audit fix: these actions spend AI budget and write drafts, so
  // they carry the same write gate as every other mutating action — and the
  // motion must belong to the caller's org, never resolved from the row.
  await requireWrite(pool);
  const orgId = await currentOrgId(pool);
  if (!orgId) throw new Error("No organization in scope.");
  const db = await pool.connect();
  try {
    const { rows } = await db.query(
      `select m.org_id, m.company_id, m.partner_seller_id, s.name as seller_name
       from revenue_motions m
       left join sellers s on s.id = m.partner_seller_id
       where m.id = $1 and m.org_id = $2`,
      [motionId, orgId],
    );
    if (rows.length === 0) throw new Error("motion not found");
    return rows[0];
  } finally {
    db.release();
  }
}

export async function generateDraftAction(motionId: string): Promise<void> {
  const ctx = await motionContext(motionId);
  const pool = getPool();
  const db = await pool.connect();
  try {
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
  } finally {
    db.release();
  }
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

  const ctx = await motionContext(motionId);
  const pool = getPool();
  const db = await pool.connect();
  try {
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
  } finally {
    db.release();
  }
  revalidatePath(`/briefs/${motionId}`);
}
