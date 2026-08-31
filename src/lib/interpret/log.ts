import type { Pool, PoolClient } from "pg";
import type { AnswerEnvelope } from "./answer";
import { catalogVersion } from "./catalog";

/**
 * Answer provenance (P2C-1 §11). Every Ask exchange lands on the record with enough to reconstruct
 * HOW it was answered — intent key, validated slots, resolution path, outcome, resolver latency,
 * scope size, and the deep links the answer stood on.
 *
 * What is stored is bounded on purpose. The slots are the operator's own words after validation;
 * `record_hrefs` are deep links, which disclose nothing on their own and re-resolve under the
 * reader's authorisation. Hit payloads, explanation bodies and amounts are NOT copied here: an
 * audit log that duplicates confidential figures becomes a second, weaker copy of them, governed
 * by nothing (§11).
 */
export async function logAnswer(
  db: Pool | PoolClient, orgId: string, env: AnswerEnvelope, model: string | null,
): Promise<void> {
  await db.query(
    `insert into ask_exchanges
       (org_id, question, answer, tool_calls, model,
        intent_key, intent_class, resolution_path, outcome, slots, record_hrefs,
        scope_size, interpret_ms, resolve_ms, total_ms, rejection, catalog_version)
     values ($1,$2,$3,'[]'::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      orgId,
      env.question.slice(0, 2000),
      env.answer.slice(0, 4000),
      model,
      env.intentKey,
      env.intentClass,
      env.path,
      env.outcome,
      env.slots ? JSON.stringify(env.slots) : null,
      JSON.stringify(env.recordIds.slice(0, 25)),
      // The SIZE of the scope, never its membership.
      env.scopeNote.match(/(\d+) account/)?.[1] ?? null,
      env.latency.interpretMs,
      env.latency.resolveMs,
      env.latency.totalMs,
      env.rejection?.slice(0, 500) ?? null,
      catalogVersion(),
    ],
  );
}
