/**
 * P7 Slice 1 — the code-defined plans the route may run.
 *
 * WHY NOT ACCEPT A CALLER-SUPPLIED PLAN. Plan ingestion is its own attack surface — it belongs with
 * the API/MCP transport, where the caller is authenticated and the payload can be bounded. Slice 1
 * is a proof about the SPINE, so the route selects from these fixed plans by a validated key and
 * nothing else reaches the validator from the request.
 *
 * These are ordinary `PursuitQuery` values with no privileges: each still passes validation and
 * still goes through governance exactly like any other plan.
 */
import { ALL_SCOPE } from "@/lib/scope/scope";
import { OPEN_STATUSES } from "./registry";
import type { PursuitQuery } from "./types";

export const VIEW_KEYS = ["open-by-value", "recently-updated", "open-pipeline-cohort"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export const isViewKey = (v: string | undefined): v is ViewKey => !!v && (VIEW_KEYS as readonly string[]).includes(v);

/**
 * The explanation plan for ONE subject (ruling 3: single object only). The id is supplied by the
 * request, which is ordinary detail-page behaviour: it names WHICH object, never which organization,
 * and governance still decides whether that object is visible at all — an unauthorized id simply
 * returns no row, indistinguishable from one that does not exist.
 */
export function explainPlanFor(pursuitId: string): PursuitQuery {
  return {
    queryVersion: 1,
    subject: { class: "pursuit", ids: [pursuitId] },
    scope: ALL_SCOPE,
    filters: [],
    metrics: [{ id: "pursuit.open_pipeline_usd", version: 1 }],
    projection: ["pursuit.id", "pursuit.account_name", "pursuit.status", "pursuit.pursuit_type", "pursuit.updated_at"],
    limit: 1,
    asOf: null,
    explain: { template: { id: "pursuit.summary", version: 1 } },
    aggregate: false,
  };
}

/**
 * THE GO TO PLAN (Slice 4). GO TO issues no query of its own (ruling 5): it runs the ordinary
 * governed boundary with this fixed plan, so the existence of a row IS the authorization, decided by
 * P6 and nothing else. There is no second read path to govern, audit or keep in sync.
 *
 * The projection is the minimum the destination can use: the identity, and the one registered cell
 * that may label the target if it survives disclosure. No metrics — a navigation request must not
 * cause a derivation.
 */
export function goToPlanFor(pursuitId: string): PursuitQuery {
  return {
    queryVersion: 1,
    subject: { class: "pursuit", ids: [pursuitId] },
    scope: ALL_SCOPE,
    filters: [],
    metrics: [],
    projection: ["pursuit.id", "pursuit.account_name"],
    limit: 1,
    asOf: null,
    explain: false,
    aggregate: false,
  };
}

export const PLANS: Record<ViewKey, { label: string; plan: PursuitQuery }> = {
  "open-by-value": {
    label: "Open pursuits by open pipeline",
    plan: {
      queryVersion: 1,
      subject: { class: "pursuit" },
      scope: ALL_SCOPE,
      filters: [{ dimension: "pursuit.status", op: "in", values: [...OPEN_STATUSES] }],
      metrics: [{ id: "pursuit.open_pipeline_usd", version: 1 }],
      projection: ["pursuit.id", "pursuit.account_name", "pursuit.status", "pursuit.pursuit_type", "pursuit.updated_at"],
      ordering: [{ ref: "metric:pursuit.open_pipeline_usd@1", dir: "desc" }],
      limit: 50,
      asOf: null,
      explain: false,
      aggregate: false,
    },
  },
  /**
   * THE SLICE 3 COHORT. Fixed and code-defined (ruling 5): no caller-supplied filtering, no filter
   * AST, no free-form dimension combinations. The organization is absent by construction — it comes
   * from the principal, and a cross-org cohort cannot be expressed here at all (ruling 4).
   */
  "open-pipeline-cohort": {
    label: "Open pipeline across open pursuits",
    plan: {
      queryVersion: 1,
      subject: { class: "pursuit" },
      scope: ALL_SCOPE,
      filters: [{ dimension: "pursuit.status", op: "in", values: [...OPEN_STATUSES] }],
      metrics: [{ id: "pursuit.open_pipeline_usd", version: 1 }],
      projection: ["pursuit.id", "pursuit.account_name", "pursuit.status", "pursuit.updated_at"],
      ordering: [{ ref: "pursuit.updated_at", dir: "desc" }],
      limit: 200,
      asOf: null,
      explain: false,
      aggregate: { id: "cohort.open_pipeline_usd", version: 1 },
    },
  },
  "recently-updated": {
    label: "Recently updated pursuits",
    plan: {
      queryVersion: 1,
      subject: { class: "pursuit" },
      scope: ALL_SCOPE,
      filters: [],
      metrics: [],
      projection: ["pursuit.id", "pursuit.account_name", "pursuit.use_case", "pursuit.status", "pursuit.updated_at"],
      ordering: [{ ref: "pursuit.updated_at", dir: "desc" }],
      limit: 50,
      asOf: null,
      explain: false,
      aggregate: false,
    },
  },
};
