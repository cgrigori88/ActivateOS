/**
 * Email provider abstraction (Phase 5 architecture rule): all provider-
 * specific logic lives behind this interface so Resend can later be replaced
 * or supplemented by Microsoft 365, Google Workspace, SendGrid, or SES
 * without touching the commercial workflow.
 */

export interface OutboundMessage {
  from: { name: string; email: string };
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  providerMessageId: string;
}

/** Normalized inbound message — provider payloads never leave the adapter. */
export interface InboundMessage {
  providerMessageId: string | null;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { name: string | null; email: string };
  to: string[];
  cc: string[];
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  receivedAt: Date;
  attachmentCount: number;
  rawHeaders: Record<string, string>;
}

export interface EmailProvider {
  send(message: OutboundMessage): Promise<SendResult>;
  processInbound(payload: unknown): InboundMessage;
}

export interface CommsConfig {
  outboundDomain: string; // e.g. engage.pursuitos.io
  threadsDomain: string; // e.g. threads.pursuitos.io
}

export function commsConfig(): CommsConfig {
  return {
    outboundDomain: process.env.EMAIL_OUTBOUND_DOMAIN ?? "engage.pursuitos.io",
    threadsDomain: process.env.EMAIL_THREADS_DOMAIN ?? "threads.pursuitos.io",
  };
}
