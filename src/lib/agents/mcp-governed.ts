import { executeExperience } from "@/lib/experience/surface/execute-experience";
import { apiCredentialPrincipal } from "@/lib/experience/principal";
import type { SurfaceOutcome } from "@/lib/experience/surface/schema";
import type { ExecutionPolicy } from "@/lib/db/execution-policy";

/**
 * P7 Slice 14 — THE GOVERNED EXTERNAL READ ADAPTER.
 *
 * > **An external adapter may authenticate a caller, resolve that caller into PursuitOS's trusted
 * > execution context, submit a closed governed experience request, and serialize the canonical
 * > result. It may not become a second semantic or authorization layer.**
 *
 * ── WHY THIS IS A SEPARATE MODULE FROM `mcp-tools.ts` ───────────────────────────────────────────
 *
 * The legacy tool surface predates P7. Most of it is fine — six of its reads route through certified
 * P6-IG federation machinery, and P7 has no business owning consent ladders. But one of them,
 * `pipeline_summary`, answered a question P7 *does* own, with its own SQL, and gave a different
 * number: **8,040,000 against P7's 6,250,000 for the same organization**, because it summed
 * opportunity amounts where P7 sums a registered per-pursuit metric over a governed cohort. Two
 * answers to one business question, chosen by which interface you happened to ask.
 *
 * > **P7 is authoritative for concepts P7 owns. Other certified domains may remain authoritative for
 * > concepts P7 does not own. Interface choice may not select between competing definitions of the
 * > same concept.**
 *
 * ── THE HANDLER TAKES NO DATABASE CLIENT, AND THAT IS THE POINT ─────────────────────────────────
 *
 * `McpToolDef.run` receives a `Pool | PoolClient`. A governed tool must not, so `GovernedToolDef.run`
 * takes only an organization id. There is no client to query with — "this handler issues no SQL" is
 * enforced by the signature rather than asked for in a comment. It reaches canonical truth the only
 * way it can: through `executeExperience`.
 *
 * It imports no `dispatchSkill`, no P45 entry point and no query builder. **Read-only external
 * reachability does not imply action reachability**, and here it cannot: there is nothing to call.
 */

/**
 * A governed tool. Deliberately NOT `McpToolDef`: no `write`, no `skillId`, and no database handle.
 * The type is the boundary.
 */
export interface GovernedToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Every governed tool is read-scoped. There is no operator variant of this type. */
  readonly scope: "read";
  /**
   * No pool, no client, no args that could carry authority — only the credential's organization and
   * the server-owned execution policy. The policy is RESOURCE metadata, not authority: it cannot
   * name an org, select a plan, widen a scope or change a number. It is separate from `orgId` for
   * exactly that reason.
   */
  run(orgId: string, policy?: ExecutionPolicy): Promise<unknown>;
}

/** The certified operation this tool exposes. Fixed here, never assembled from caller input. */
const OPEN_PIPELINE_SPEC = {
  specVersion: 1,
  layout: "stack",
  components: [
    { component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort" } },
  ],
} as const;

/**
 * Serialize ONE canonical result. Presentation only.
 *
 * It formats what the executor already computed and does nothing else: no query, no recomputation,
 * no second cohort, no stage weighting, no enrichment from `opportunities`, no model call.
 *
 * THE WITHHELD CASE IS THE REASON THIS FUNCTION IS HAND-WRITTEN. A governed aggregate is withheld
 * whole — *"computed only when EVERY member's contribution is disclosable to you"* — and a consumer
 * of this tool is usually a language model. Serializing that as `0`, as `null`, or as an absent key
 * would invite the model to read "nothing is in the pipeline", which is a different and false claim.
 * So withholding is carried as an explicit state with no numeric field at all.
 */
export function serializeOpenPipeline(outcome: SurfaceOutcome): Record<string, unknown> {
  if (!outcome.ok) return { status: dispositionOf(outcome.error) };

  const component = outcome.result.components[0];
  if (!component || component.kind !== "READ") return { status: "UNAVAILABLE" };
  const execution = component.outcome;
  if (execution.kind !== "RESULT" || !execution.outcome.ok) return { status: "UNAVAILABLE" };
  const aggregate = execution.outcome.aggregate;
  if (!aggregate) return { status: "UNAVAILABLE" };

  const base = {
    concept: "pursuit_open_pipeline",
    metric: `${aggregate.aggregate.id}@${aggregate.aggregate.version}`,
    over: `${aggregate.over.id}@${aggregate.over.version}`,
    operation: aggregate.operation,
    interpretedAs: component.interpretedAs,
    provenance: aggregate.provenance,
    specVersion: outcome.result.provenance.specVersion,
    compilerVersion: outcome.result.provenance.compilerVersion,
  };
  // EXACT is the only visibility that carries a number. Anything else is a governed non-disclosure,
  // and it leaves without one.
  return aggregate.visibility === "EXACT"
    ? { status: "DISCLOSED", value: aggregate.value, currency: "USD", ...base }
    : { status: aggregate.visibility, ...base };
}

/** Canonical dispositions, preserved rather than flattened. None carries internal detail. */
function dispositionOf(error: Exclude<SurfaceOutcome, { ok: true }>["error"]): string {
  switch (error) {
    case "CAPABILITY_DENIED": return "CAPABILITY_NOT_ENABLED";
    case "NOT_AVAILABLE": return "NOT_AVAILABLE";
    case "NO_SELECTABLE_RESULT": return "NO_SELECTABLE_RESULT";
    case "INVALID": return "INVALID_REQUEST";
    default: return "FAILED";
  }
}

export const GOVERNED_MCP_TOOLS: GovernedToolDef[] = [
  {
    name: "pipeline_summary",
    scope: "read",
    description:
      "PursuitOS canonical open pipeline: the governed sum of the registered per-pursuit "
      + "open-pipeline metric across this tenant's open-pursuit cohort. This is the authoritative "
      + "answer to \"what is my open pipeline\". The whole figure is withheld rather than partially "
      + "computed when any cohort member's contribution is not disclosable to you. For the "
      + "opportunity-level, stage-weighted forecast — a different concept — see "
      + "opportunity_pipeline_summary. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(orgId: string, policy?: ExecutionPolicy) {
      // The request is FIXED here. A caller supplies no spec, no plan key, no context, no metric
      // argument and no organization — the credential already established the organization, and the
      // operation is the one this tool is named for.
      const outcome = await executeExperience({
        requestVersion: 1,
        spec: OPEN_PIPELINE_SPEC,
        contextSource: { kind: "NONE" },
        source: "HAND_AUTHORED",
        modelId: null,
        promptTemplateVersion: null,
        boundContextDigest: null,
      }, apiCredentialPrincipal(orgId), policy);
      return serializeOpenPipeline(outcome);
    },
  },
];
