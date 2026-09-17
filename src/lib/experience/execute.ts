/**
 * P7 Slice 1 — THE HEADLESS EXECUTION BOUNDARY.
 *
 *   validate → registry resolution → GOVERNANCE → GovernedResultSet → deterministic computation → projection
 *
 * Every interface calls this. The web route carries transport concerns only and duplicates none of
 * the semantics below (ruling 6). There is no second path that reads canonical rows and hands them
 * to presentation.
 *
 * THE ORDER IS LOAD-BEARING. Governance precedes computation, so a suppressed input can never reach
 * the metric and the metric can never be computed and then hidden. Nothing here is memoized across
 * requests and nothing consults a cached verdict.
 *
 * NO SQL IDENTIFIER ORIGINATES IN A PLAN. Column names come from the registry; every plan-supplied
 * value is a bound parameter. The plan contributes *which registry keys*, never *what text*.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenant, withTenantOrg } from "@/lib/db/tenant";
import { experienceEnabledFor } from "@/lib/pursuits/tenant-flags";
import { resolveScope } from "@/lib/scope/server";
import { buildFederationViewer } from "@/lib/pursuits/federation/grants";
import { resolveDisclosure, type Disclosable, type FederationViewer } from "@/lib/pursuits/federation/disclosure";
import { mayDerive } from "@/lib/pursuits/federation/derivation";
import { FIELDS, FILTERS, METRICS, metricKey } from "./registry";
import { validatePlan } from "./validate";
import { principalOrgId, type ExecutionPrincipal } from "./principal";
import { explain } from "./explain";
import type { ExecuteOutcome, Explanation, FieldRef, GovernedCell, GovernedResultSet, GovernedRow, MetricRef, PursuitQuery } from "./types";

/** One candidate row as the canonical loader returns it — pre-governance, never leaves this module. */
interface CandidateRow {
  id: string;
  org_id: string;
  [column: string]: unknown;
}

/**
 * Execute a validated plan. The caller has already established the principal and the environment
 * master; this owns the tenant-aware capability check, governance and computation.
 *
 * THE ORGANIZATION IS NEVER A REQUEST PARAMETER. Omitted — the web path — it comes from the
 * authenticated session via `withTenant`, exactly as every screen resolves it. Supplied, it arrives
 * as an `ExecutionPrincipal`, which only a trusted resolver in ./principal.ts can mint (the brand is
 * a module-private symbol, so `{ orgId: req.query.org }` neither type-checks nor exists). The
 * boundary then uses `withTenantOrg`, the established primitive for callers whose organization comes
 * from their own credential rather than a cookie.
 *
 * The earlier shape took a raw `{ orgId }`, which a transport could have filled from caller input.
 * The boundary could not tell the difference, so it must not offer the choice: interface possession
 * does not confer authority.
 */
export async function executePursuitQuery(candidate: unknown, principal?: ExecutionPrincipal): Promise<ExecuteOutcome> {
  const v = validatePlan(candidate);
  if (!v.ok) return { ok: false, error: "INVALID_PLAN", detail: v.detail };
  const plan = v.plan;

  const run = async (db: PoolClient, orgId: string): Promise<ExecuteOutcome> => {
    // TENANT ENTITLEMENT. The environment master is a deployment switch; this is the org's own
    // entitlement, and a missing or false row denies. Both must pass (ruling 1).
    if (!(await experienceEnabledFor(db, orgId))) {
      return { ok: false as const, error: "CAPABILITY_DENIED" as const, detail: "the Pursuit experience is not enabled for this organization" };
    }

    // SCOPE. Resolution narrows within the caller's authorized set; a plan cannot widen it, because
    // membership is computed here from the tenant's own data rather than taken from the request.
    const scope = await resolveScope(db, orgId, plan.scope);

    const candidates = await loadCandidates(db, plan, scope.companyIds ?? null);
    const rows: GovernedRow[] = [];
    const omissions: GovernedResultSet["omissions"] = [];

    for (const row of candidates) {
      // GOVERNANCE, per object, before any value is read into a cell.
      const viewer = await buildFederationViewer(db, orgId, row.id);
      const cells: Record<string, GovernedCell> = {};

      for (const ref of plan.projection) {
        const cell = governField(ref, row, viewer);
        cells[ref] = cell;
        if (cell.visibility === "SUPPRESSED") omissions.push({ objectId: row.id, ref, reason: cell.reason ?? "NOT_DISCLOSABLE" });
      }

      for (const m of plan.metrics) {
        const cell = await governMetric(db, orgId, m, row, viewer);
        cells[metricKey(m)] = cell;
        if (cell.visibility === "SUPPRESSED") omissions.push({ objectId: row.id, ref: metricKey(m), reason: cell.reason ?? "NOT_DISCLOSABLE" });
      }

      rows.push({ objectRef: { class: "pursuit", id: row.id }, cells });
    }

    orderRows(rows, plan);
    const limited = plan.limit ? rows.slice(0, plan.limit) : rows;

    // The instant comes from the database, in SQL — never a JavaScript Date (D-P6-1).
    const { rows: at } = await db.query<{ t: string }>(`select transaction_timestamp()::text as t`);

    const resultSet: GovernedResultSet = {
        plan,
        planDigest: planDigestOf(plan),
        computedAt: at[0].t,
        rows: limited,
        omissions: omissions.filter((o) => limited.some((r) => r.objectRef.id === o.objectId)),
        counts: { authorized: limited.length },
    };

    // EXPLAIN (Slice 2). The renderer is pure and sees only what governance produced: turning it on
    // cannot widen a result, because there is no path from here back to the database.
    let explanation: Explanation | undefined;
    let explanationError: string | undefined;
    if (plan.explain !== false) {
      const e = explain(resultSet, plan.explain.template.id, plan.explain.template.version);
      if (e.ok) explanation = e.explanation; else explanationError = e.detail;
    }

    return { ok: true as const, result: resultSet, explanation, explanationError };
  };

  if (principal) {
    const orgId = principalOrgId(principal);
    return withTenantOrg(orgId, (db) => run(db, orgId));
  }
  return withTenant((db, orgId) => run(db, orgId));
}

/**
 * Load candidates. RLS and `can_see_pursuit` decide membership — this adds no visibility of its own,
 * and could not, since it runs as `app_rw` under the tenant GUC.
 *
 * Every identifier in the statement comes from the registry; every plan value is a bound parameter.
 */
async function loadCandidates(db: PoolClient, plan: PursuitQuery, scopeCompanyIds: string[] | null): Promise<CandidateRow[]> {
  const selected = new Set<FieldRef>(plan.projection);
  selected.add("pursuit.id");
  const columns = [...selected].map((ref) => {
    const def = FIELDS[ref];
    return def.expression ? `${def.expression} as ${def.column}` : `p.${def.column}`;
  });
  // org_id is always loaded: ownership decides disclosure, and it is never projected.
  const params: unknown[] = [];
  const where: string[] = [];

  for (const f of plan.filters) {
    const def = FILTERS[f.dimension];
    if (f.op === "=") { params.push(f.values[0]); where.push(`p.${def.column} = $${params.length}`); }
    else { params.push(f.values); where.push(`p.${def.column} = any($${params.length}::text[])`); }
  }
  if (plan.subject.ids?.length) { params.push(plan.subject.ids); where.push(`p.id = any($${params.length}::uuid[])`); }
  if (scopeCompanyIds) { params.push(scopeCompanyIds); where.push(`p.account_id = any($${params.length}::uuid[])`); }

  const sql = `select p.id, p.org_id, ${columns.join(", ")} from pursuits p
               ${where.length ? `where ${where.join(" and ")}` : ""}
               order by p.id asc`;
  const { rows } = await db.query<CandidateRow>(sql, params);
  return rows;
}

/** Resolve one field through the disclosure ladder. A suppressed cell carries NO value. */
function governField(ref: FieldRef, row: CandidateRow, viewer: FederationViewer): GovernedCell {
  const def = FIELDS[ref];
  const raw = row[def.column];
  const item: Disclosable<string | number | null> = {
    key: ref,
    ownerOrgId: row.org_id,
    audience: def.audience,
    value: raw === null || raw === undefined ? null : (raw instanceof Date ? raw.toISOString() : (raw as string | number)),
  };
  const res = resolveDisclosure(item, viewer);
  // EXISTENCE. The row reached this point only because RLS and can_see_pursuit admitted it, and a
  // registered field is schema-level knowledge, so the recipient may know the cell EXISTS even when
  // its value is withheld. A future field whose existence is itself governed would set UNAUTHORIZED
  // here, and the renderer would then emit nothing for it at all.
  return res.visibility === "SUPPRESSED"
    ? { visibility: "SUPPRESSED", value: null, provenance: ref, reason: "NOT_DISCLOSABLE", existence: "AUTHORIZED" }
    : { visibility: res.visibility, value: res.value, provenance: ref, existence: "AUTHORIZED" };
}

/**
 * Resolve and compute one metric.
 *
 * `mayDerive` is NECESSARY BUT NOT SUFFICIENT (ruling 7): derivation authority admits the attempt,
 * and each contributing input must then survive disclosure resolution. A suppressed input does not
 * contribute — not directly, and not indirectly through a partial sum, a zero, or a count — because
 * the whole result is withheld the moment any input is withheld. That is the zero-safe-
 * declassification rule applied to an aggregate: with no approved transform, a result formed from a
 * hidden input is NOT_DISCLOSABLE.
 */
async function governMetric(
  db: PoolClient, viewerOrgId: string, ref: MetricRef, row: CandidateRow, viewer: FederationViewer,
): Promise<GovernedCell> {
  const def = METRICS[metricKey(ref)];
  const provenance = `${def.id}@${def.version}`;

  // 1. DERIVATION AUTHORITY, before an input is read.
  const decision = await mayDerive(db, viewerOrgId,
    { inputKind: def.deriveInputKind, sourceOrgId: row.org_id, pursuitId: row.id }, def.derivePurpose);
  if (!decision.allow) {
    return { visibility: "SUPPRESSED", value: null, provenance, reason: "DERIVATION_DENIED", existence: "AUTHORIZED" };
  }

  // 2. INPUTS, each resolved through the ladder as its own disclosable item.
  const { rows: inputs } = await db.query<{ id: string; org_id: string; amount_usd: string | null }>(
    `select o.id, o.org_id, o.amount_usd from opportunities o
      where o.pursuit_id = $1 and o.stage not in ('closed_won','closed_lost')`, [row.id]);

  const governed: number[] = [];
  for (const input of inputs) {
    const res = resolveDisclosure<string | null>(
      { key: `${def.id}.input`, ownerOrgId: input.org_id, audience: "PARTICIPANT_SHARED", value: input.amount_usd },
      viewer,
    );
    // ANY withheld input withholds the whole result. No partial sum, no zero substitute.
    if (res.visibility === "SUPPRESSED") {
      return { visibility: "SUPPRESSED", value: null, provenance, reason: "INPUT_NOT_DISCLOSABLE", existence: "AUTHORIZED" };
    }
    governed.push(Number(res.value ?? 0));
  }

  // 3. COMPUTATION, over governed inputs only. Deterministic, no I/O of its own.
  return { visibility: "EXACT", value: computeSum(governed), provenance, existence: "AUTHORIZED" };
}

/**
 * A stable digest of the validated plan: registry keys and bound values only. It binds an
 * explanation to its parent execution (ruling 1) and carries no governed data — the suite proves it
 * cannot be used to reconstruct any, because nothing that is not already in the plan enters it.
 */
export function planDigestOf(plan: PursuitQuery): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}

/** The metric's arithmetic, isolated so it is testable without a database. */
export function computeSum(values: number[]): number {
  return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

/**
 * Deterministic total ordering. `pursuit.id asc` is always the final key, so the order is total and
 * two executions of one plan cannot differ. A suppressed metric sorts last regardless of direction:
 * it has no value, and inventing one for sorting would leak that a value exists.
 */
function orderRows(rows: GovernedRow[], plan: PursuitQuery): void {
  const keys = plan.ordering ?? [];
  rows.sort((a, b) => {
    for (const k of keys) {
      const ref = k.ref.startsWith("metric:") ? k.ref.slice("metric:".length) : k.ref;
      const av = a.cells[ref], bv = b.cells[ref];
      const aNull = !av || av.visibility === "SUPPRESSED" || av.value === null;
      const bNull = !bv || bv.visibility === "SUPPRESSED" || bv.value === null;
      if (aNull && bNull) continue;
      if (aNull) return 1;
      if (bNull) return -1;
      const cmp = typeof av.value === "number" && typeof bv.value === "number"
        ? av.value - bv.value
        : String(av.value).localeCompare(String(bv.value));
      if (cmp !== 0) return k.dir === "desc" ? -cmp : cmp;
    }
    return a.objectRef.id.localeCompare(b.objectRef.id);
  });
}
