import type { PoolClient } from "pg";
import { dispatchSkill, type Actor } from "../pursuits/federation/skills";
import { registerExecutor, type ProviderResult } from "../pursuits/federation/executor";
import { sendTouchNow } from "./sequence";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Governed outreach send (Release Gate R1-G4). An APPROVED send is a governed
 * EXTERNAL_ACTION: `enqueueApprovedSend` dispatches it through `dispatchSkill`, which
 * records the invocation and enqueues the transactional outbox — it does NOT send.
 * The real side effect happens only when the outbox executor drains the row, and only
 * for a PRODUCTION action with real execution explicitly allowed (dark by default).
 * `registerOutreachExecutor()` binds the real provider call (`sendTouchNow`) to the
 * `outreach.send` action family; it must be called once at process start on any
 * surface that will actually drain sends (the worker).
 */

let registered = false;
export function registerOutreachExecutor(): void {
  if (registered) return;
  registered = true;
  registerExecutor("outreach.send", async (db, job): Promise<ProviderResult> => {
    const touchId = String(job.payload.touchId ?? "");
    if (!touchId) return { outcome: "FAILED_FINAL", failureClass: "PERMANENT", detail: { reason: "no touchId" } };
    // sendTouchNow flips the touch to 'sent' only AFTER the provider returns a message id,
    // so the commercial record never says "sent" before the provider confirms.
    const { messageId } = await sendTouchNow(db, { touchId });
    return { outcome: "SUCCEEDED", providerActionId: messageId, detail: { touchId } };
  });
}

/**
 * Enqueue an approved outreach send as a governed EXTERNAL_ACTION. Idempotent on the
 * touch (a given touch enqueues once). Returns the dispatch result; the send itself is
 * performed later by the outbox executor.
 */
export async function enqueueApprovedSend(
  db: PoolClient, actor: Actor, touchId: string, dataEnvironment: DataEnvironment = "PRODUCTION",
) {
  return dispatchSkill(db, "send_campaign_touch", actor, {
    args: { touchId }, idempotencyKey: `send:${touchId}`, dataEnvironment,
  });
}
