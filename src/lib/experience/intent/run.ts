/**
 * P7 Slice 5 — EXECUTING A COMPILED INTENT.
 *
 * Every branch here hands off to a boundary that was HOSTED ACCEPTED in an earlier slice, unchanged:
 * `executePursuitQuery` with a fixed plan (Slices 1–3) or `resolveGoTo` (Slice 4). There is no
 * execution path that exists because of Slice 5.
 *
 * THE REMOVABILITY INVARIANT IS STRUCTURAL. This function takes a `CompiledIntent` and cannot tell
 * whether a model, a form, a script or a test fixture produced it — so removing the model changes
 * nothing about meaning, permissions or execution semantics. That is not an argument; it is the
 * signature.
 */
import { executePursuitQuery, resolveGoTo } from "../execute";
import { PLANS, explainPlanFor } from "../plans";
import type { ExecutionPrincipal } from "../principal";
import type { CompiledIntent } from "./schema";
import type { ExecuteOutcome, GoToOutcome } from "../types";

export type IntentExecution =
  | { kind: "RESULT"; outcome: ExecuteOutcome }
  | { kind: "NAVIGATION"; outcome: GoToOutcome };

export async function runCompiledIntent(intent: CompiledIntent, principal?: ExecutionPrincipal): Promise<IntentExecution> {
  switch (intent.operation) {
    case "SHOW_ME":
    case "ANALYZE": {
      // The fixed, code-defined plan — the same object the `?view=` transport runs. The compiler
      // chose WHICH registered plan; it did not author one.
      const { view } = intent.request as { view: keyof typeof PLANS };
      return { kind: "RESULT", outcome: await executePursuitQuery(PLANS[view].plan, principal) };
    }
    case "EXPLAIN": {
      const { subjectId } = intent.request as { subjectId: string };
      return { kind: "RESULT", outcome: await executePursuitQuery(explainPlanFor(subjectId), principal) };
    }
    case "GO_TO":
      return { kind: "NAVIGATION", outcome: await resolveGoTo(intent.request, principal) };
  }
}
