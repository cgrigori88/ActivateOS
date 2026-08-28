import { NextResponse } from "next/server";
import { getOwnerPool } from "@/db/client";
import { processInboundMessage } from "@/lib/comms/inbound";
import { ResendProvider, verifyWebhookSignature } from "@/lib/comms/resend";
import { suppress } from "@/lib/comms/send";
import { deriveEngagement, emitEngagementSignals } from "@/lib/intel/engagement";
import { scoreOrg } from "@/lib/scoring/score";

const ENGAGEMENT_TARGET_SLUG = "infrastructure-automation";

export const dynamic = "force-dynamic";

const EVENT_MAP: Record<string, string> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.bounced": "BOUNCED",
  "email.opened": "OPENED",
  "email.clicked": "CLICKED",
  "email.complained": "SPAM_COMPLAINT",
};

export async function POST(req: Request): Promise<NextResponse> {
  const rawBody = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const ok = verifyWebhookSignature({
      secret,
      id: req.headers.get("svix-id") ?? "",
      timestamp: req.headers.get("svix-timestamp") ?? "",
      signatureHeader: req.headers.get("svix-signature") ?? "",
      rawBody,
    });
    if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  } else {
    // No secret configured → refuse rather than accept unauthenticated events.
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  let payload: { type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const type = payload.type ?? "";

  const pool = getOwnerPool();
  const db = await pool.connect();
  try {
    // Inbound customer email → the full intelligence pipeline.
    if (type === "email.received" || type.startsWith("inbound.")) {
      const provider = new ResendProvider();
      const outcome = await processInboundMessage(db, provider.processInbound(payload));
      return NextResponse.json(outcome);
    }

    // Delivery lifecycle events → normalized email_events.
    const mapped = EVENT_MAP[type];
    if (mapped) {
      const providerId = (payload.data?.email_id as string) ?? null;
      const { rows } = await db.query<{ id: string; thread_id: string }>(
        `select id, thread_id from messages where provider_message_id = $1`,
        [providerId],
      );
      if (rows.length > 0) {
        await db.query(
          `insert into email_events (message_id, thread_id, event_type, payload)
           values ($1, $2, $3, $4)`,
          [rows[0].id, rows[0].thread_id, mapped, JSON.stringify(payload.data ?? {})],
        );

        // Engagement → intelligence (Phase 9D). Opens refresh the rollup; a
        // click is meaningful enough to emit a scoring signal and rescore.
        if (mapped === "OPENED" || mapped === "CLICKED") {
          const { rows: ctx } = await db.query<{ org_id: string | null; company_id: string }>(
            `select org_id, company_id from communication_threads where id = $1`,
            [rows[0].thread_id],
          );
          if (ctx.length > 0) {
            const { org_id, company_id } = ctx[0];
            if (mapped === "CLICKED") {
              await emitEngagementSignals(db, { orgId: org_id, companyId: company_id });
              if (org_id) await scoreOrg(db, org_id, ENGAGEMENT_TARGET_SLUG).catch(() => undefined);
            } else {
              await deriveEngagement(db, { orgId: org_id, companyId: company_id });
            }
          }
        }
      }
      // Bounces and complaints suppress immediately — no exceptions.
      if (mapped === "BOUNCED" || mapped === "SPAM_COMPLAINT") {
        const to = (payload.data?.to as string[] | string) ?? [];
        for (const email of Array.isArray(to) ? to : [to]) {
          await suppress(
            db,
            null,
            email,
            mapped === "BOUNCED" ? "hard_bounce" : "spam_complaint",
          );
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, ignored: type });
  } finally {
    db.release();
  }
}
