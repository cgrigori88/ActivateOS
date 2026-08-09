import type { InboundMessage } from "./provider";
import { extractThreadAlias } from "./alias";

/**
 * Deterministic thread matching (founder decision §6). Order is law:
 *   1. unique PursuitOS thread alias in any recipient;
 *   2. In-Reply-To header against known message ids;
 *   3. References header against known message ids;
 *   4. provider message id;
 *   5. exact participants + normalized subject;
 *   6. human triage — NEVER an LLM guess.
 */

export interface ThreadCandidateIndex {
  /** thread_alias → threadId */
  byAlias: Map<string, string>;
  /** internet_message_id → threadId (from stored messages) */
  byInternetMessageId: Map<string, string>;
  /** provider_message_id → threadId */
  byProviderMessageId: Map<string, string>;
  /** `${sortedParticipants}|${normalizedSubject}` → threadId */
  byParticipantsSubject: Map<string, string>;
}

export function normalizeSubject(subject: string | null): string {
  return (subject ?? "")
    .toLowerCase()
    .replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function participantsSubjectKey(emails: string[], subject: string | null): string {
  const participants = [...new Set(emails.map((e) => e.toLowerCase().trim()))].sort();
  return `${participants.join(",")}|${normalizeSubject(subject)}`;
}

export interface ThreadMatch {
  threadId: string;
  matchedBy:
    | "alias"
    | "in_reply_to"
    | "references"
    | "provider_message_id"
    | "participants_subject";
}

export function resolveThread(
  msg: InboundMessage,
  index: ThreadCandidateIndex,
  threadsDomain: string,
): ThreadMatch | null {
  const alias = extractThreadAlias([...msg.to, ...msg.cc], threadsDomain);
  if (alias) {
    const threadId = index.byAlias.get(alias);
    if (threadId) return { threadId, matchedBy: "alias" };
  }

  if (msg.inReplyTo) {
    const threadId = index.byInternetMessageId.get(msg.inReplyTo);
    if (threadId) return { threadId, matchedBy: "in_reply_to" };
  }

  for (const ref of msg.references) {
    const threadId = index.byInternetMessageId.get(ref);
    if (threadId) return { threadId, matchedBy: "references" };
  }

  if (msg.providerMessageId) {
    const threadId = index.byProviderMessageId.get(msg.providerMessageId);
    if (threadId) return { threadId, matchedBy: "provider_message_id" };
  }

  const key = participantsSubjectKey([msg.from.email, ...msg.to, ...msg.cc], msg.subject);
  const threadId = index.byParticipantsSubject.get(key);
  if (threadId) return { threadId, matchedBy: "participants_subject" };

  return null; // → inbound_triage
}
