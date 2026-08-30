import type { Reason } from "./partner-activation";
import type { DisclosureClass } from "./types";

/**
 * Route explanation with disclosure policy (Workstream C, §33/§38/§49). Two levels: an
 * INTERNAL explanation with full detail, and a SHAREABLE explanation that generalizes or drops
 * confidential detail (transaction values, PII, restricted). Regenerating prose never changes
 * any commercial truth — the structured reasons are authoritative.
 */

const CONFIDENTIAL: DisclosureClass[] = ["TRANSACTION_CONFIDENTIAL", "PII", "RESTRICTED"];

const GENERALIZED: Record<string, string> = {
  TRANSACTION_ADJACENCY: "Recent channel activity strengthens this route",
  STRONG_ACCOUNT_RELATIONSHIP: "Existing customer relationship",
  RELEVANT_CAPABILITY: "Relevant delivery capability",
};

export interface ExplanationLine { code: string; text: string; polarity: 1 | -1 }

export function buildExplanation(reasons: Reason[], audience: "internal" | "shareable"): ExplanationLine[] {
  const lines: ExplanationLine[] = [];
  for (const r of reasons) {
    const confidential = CONFIDENTIAL.includes(r.disclosureClass as DisclosureClass);
    if (audience === "shareable") {
      if (r.disclosureClass === "RESTRICTED" || r.disclosureClass === "PII") continue;   // drop entirely
      const text = confidential ? (GENERALIZED[r.reasonCode] ?? "Additional channel signal") : (GENERALIZED[r.reasonCode] ?? r.detail);
      lines.push({ code: r.reasonCode, text, polarity: r.polarity });
    } else {
      lines.push({ code: r.reasonCode, text: r.detail, polarity: r.polarity });
    }
  }
  return lines;
}
