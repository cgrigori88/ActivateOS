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

export const VIEW_KEYS = ["open-by-value", "recently-updated"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export const isViewKey = (v: string | undefined): v is ViewKey => !!v && (VIEW_KEYS as readonly string[]).includes(v);

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
    },
  },
};
