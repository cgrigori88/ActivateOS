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

/**
 * P7 SLICE 8 — THE CLOSED SELECTOR VOCABULARY.
 *
 * `"first"` is its own certified capability, deliberately a WORD and not an ordinal: an integer
 * invites arbitrary N, and "the second row" is a different capability with its own disclosure
 * question (it lets a caller walk the governed set).
 */
export const SELECTOR_KEYS = ["first"] as const;
export type SelectorKey = (typeof SELECTOR_KEYS)[number];
export const isSelectorKey = (v: unknown): v is SelectorKey =>
  typeof v === "string" && (SELECTOR_KEYS as readonly string[]).includes(v);

/**
 * WHICH SELECTORS A PLAN MAY EXPORT IDENTITY FOR. Absent means NONE (ruling F).
 *
 * > **Being a SHOW ME operation does not imply being a safe identity-export source. Identity export is
 * > an explicit certified registry capability.**
 *
 * A plan earns this only when its ORDERING AND DISCLOSURE contract has actually been certified: that
 * ordering runs on governed cells after governance, that a suppressed value cannot acquire an invented
 * sort key and therefore cannot promote a row, that the order is total, and that `limit` is applied
 * after ordering. A future view that returns pursuits gets nothing by default.
 */
export interface IdentityExport { selectors: readonly SelectorKey[] }

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

export const PLANS: Record<ViewKey, { label: string; plan: PursuitQuery; identityExport?: IdentityExport }> = {
  "open-by-value": {
    label: "Open pursuits by open pipeline",
    /**
     * THE ONLY PLAN CERTIFIED TO EXPORT IDENTITY IN SLICE 8, and only for `first`.
     *
     * Its ordering is `metric:pursuit.open_pipeline_usd@1 desc` with `pursuit.id asc` as the final
     * key, applied by `orderRows` to ALREADY-GOVERNED rows — so a withheld value sorts last rather
     * than acquiring a position, the order is total, and `limit` slices afterwards. "First" is
     * therefore canonical, stable, and derived only from what this recipient may already see.
     */
    identityExport: { selectors: ["first"] },
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
