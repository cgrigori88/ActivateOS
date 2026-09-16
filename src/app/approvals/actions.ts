"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decide, NoTrustedPrincipalError, RuntimeDisabledError } from "@/lib/runtime/entry";

/**
 * P45-2 — the interactive decision boundary.
 *
 * The approver identity is NEVER taken from this form. `decide()` resolves the principal
 * server-side and fails closed when it cannot, which is the whole point: an approver identity a
 * caller can assert is not an approval, it is a request to be trusted. In a deployment without
 * application auth configured that means these buttons legitimately refuse — the server model is
 * deliberately stricter than the demo can exercise, and we say so rather than faking a decision.
 */
async function act(requestId: string, decision: "APPROVED" | "REJECTED", formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  let notice: string;
  try {
    const out = await decide(requestId, decision, reason);
    notice = out.status === "DECIDED" ? `Request ${decision.toLowerCase()}.`
      : out.status === "INVALIDATED" ? `No longer decidable — ${out.reason}. The pending request was withdrawn.`
      : out.status === "ALREADY_DECIDED" ? "Someone else already decided this request."
      : `Refused: ${out.reason ?? out.status}`;
  } catch (e) {
    notice = e instanceof NoTrustedPrincipalError
      ? "Refused: no signed-in identity could be verified on the server, so this decision cannot be attributed to anyone. Approvals require configured authentication."
      : e instanceof RuntimeDisabledError
        ? "The governed runtime is not enabled for this deployment or organization."
        : `Refused: ${e instanceof Error ? e.message : String(e)}`;
  }
  revalidatePath("/approvals");
  redirect(`/approvals?notice=${encodeURIComponent(notice)}`);
}

export async function approveAction(requestId: string, formData: FormData): Promise<void> { await act(requestId, "APPROVED", formData); }
export async function rejectAction(requestId: string, formData: FormData): Promise<void> { await act(requestId, "REJECTED", formData); }
