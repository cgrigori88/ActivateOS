import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailProvider, InboundMessage, OutboundMessage, SendResult } from "./provider";

/**
 * Resend adapter — the ONLY file that knows Resend's API shapes. Sending
 * and inbound handling both live here so V1 stays on one provider; the
 * commercial workflow only ever sees the EmailProvider interface.
 */

const API = "https://api.resend.com";

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      "RESEND_API_KEY is not set — outbound email is disabled until Resend is configured",
    );
  }
  return key;
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export class ResendProvider implements EmailProvider {
  async send(message: OutboundMessage): Promise<SendResult> {
    const res = await fetch(`${API}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${message.from.name} <${message.from.email}>`,
        to: message.to,
        cc: message.cc,
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      }),
    });
    if (!res.ok) {
      throw new Error(`resend send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { id: string };
    return { providerMessageId: body.id };
  }

  /** Normalize a Resend inbound-email webhook payload. */
  processInbound(payload: unknown): InboundMessage {
    const p = payload as {
      data?: {
        email_id?: string;
        message_id?: string;
        from?: string | { email?: string; name?: string };
        to?: string[] | string;
        cc?: string[] | string;
        subject?: string;
        text?: string;
        html?: string;
        headers?: Record<string, string> | { name: string; value: string }[];
        attachments?: unknown[];
        created_at?: string;
      };
    };
    const d = p.data ?? {};

    const headers: Record<string, string> = {};
    if (Array.isArray(d.headers)) {
      for (const h of d.headers) headers[h.name.toLowerCase()] = h.value;
    } else if (d.headers) {
      for (const [k, v] of Object.entries(d.headers)) headers[k.toLowerCase()] = v;
    }

    const parseAddr = (raw: string): { name: string | null; email: string } => {
      const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
      if (m) return { name: m[1]?.trim() || null, email: m[2].toLowerCase().trim() };
      return { name: null, email: raw.toLowerCase().trim() };
    };
    const list = (v: string[] | string | undefined): string[] =>
      v == null ? [] : (Array.isArray(v) ? v : v.split(",")).map((a) => parseAddr(a).email);

    const from =
      typeof d.from === "string"
        ? parseAddr(d.from)
        : { name: d.from?.name ?? null, email: (d.from?.email ?? "").toLowerCase() };

    const refs = (headers["references"] ?? "").match(/<[^>]+>/g) ?? [];

    return {
      providerMessageId: d.email_id ?? null,
      internetMessageId: d.message_id ?? headers["message-id"] ?? null,
      inReplyTo: headers["in-reply-to"]?.match(/<[^>]+>/)?.[0] ?? null,
      references: refs,
      from,
      to: list(d.to),
      cc: list(d.cc),
      subject: d.subject ?? null,
      textBody: d.text ?? null,
      htmlBody: d.html ?? null,
      receivedAt: d.created_at ? new Date(d.created_at) : new Date(),
      attachmentCount: d.attachments?.length ?? 0,
      rawHeaders: headers,
    };
  }
}

/**
 * Verify a Resend webhook (svix scheme): signed content is
 * `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret,
 * compared constant-time against each signature in the header.
 */
export function verifyWebhookSignature(args: {
  secret: string; // whsec_...
  id: string; // svix-id header
  timestamp: string; // svix-timestamp header
  rawBody: string;
  signatureHeader: string; // svix-signature header: "v1,<b64> v1,<b64>..."
  toleranceSeconds?: number;
  now?: Date;
}): boolean {
  const tolerance = args.toleranceSeconds ?? 300;
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (args.now ?? new Date()).getTime() / 1000;
  if (Math.abs(nowSec - ts) > tolerance) return false;

  const secret = Buffer.from(args.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secret)
    .update(`${args.id}.${args.timestamp}.${args.rawBody}`)
    .digest();

  for (const part of args.signatureHeader.split(/\s+/)) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const candidate = Buffer.from(sig, "base64");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return true;
    }
  }
  return false;
}
