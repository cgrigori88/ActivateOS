/**
 * P7 Slice 1 — PLAN VALIDATION. Deterministic, total, and the only door to execution.
 *
 * A plan that does not validate is never executed, never repaired into something adjacent, and
 * never partially run. Validation happens BEFORE any database connection is opened, so an invented
 * metric or an unregistered field cannot cause so much as a query.
 *
 * Rejection names the offending identifier and nothing else — no nearest match, no suggestion. A
 * "did you mean" is a guess, and this layer does not guess.
 */
import { isAllScope, type Scope } from "@/lib/scope/scope";
import { FIELDS, FILTERS, MAX_LIMIT, METRICS, OBJECT_CLASSES, ORDERABLE, metricKey } from "./registry";
import type { Filter, MetricRef, OrderRef, PursuitQuery } from "./types";

export type ValidationResult = { ok: true; plan: PursuitQuery } | { ok: false; detail: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCOPE_KINDS = new Set(["ALL", "PARTNER", "VENDOR", "TERRITORY", "SELLER", "PERSONAL"]);
const PLAN_KEYS = new Set([
  "queryVersion", "subject", "scope", "filters", "metrics", "projection", "ordering", "limit", "asOf", "explain",
]);

const fail = (detail: string): ValidationResult => ({ ok: false, detail });

/**
 * Validate an untrusted candidate plan. The input is `unknown` on purpose: in later slices it may
 * arrive from a model or a transport, and the type system must not be the only thing standing
 * between an arbitrary object and execution.
 */
export function validatePlan(candidate: unknown): ValidationResult {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return fail("plan must be an object");
  const p = candidate as Record<string, unknown>;

  // Unknown keys are rejected rather than ignored: a silently dropped field is a silently changed
  // question, and the surface must be regenerable from exactly what was validated.
  for (const k of Object.keys(p)) if (!PLAN_KEYS.has(k)) return fail(`unknown plan key ${k}`);

  if (p.queryVersion !== 1) return fail("queryVersion must be 1");
  if (p.asOf !== null) return fail("asOf must be null — Slice 1 has no historical semantics");
  if (p.explain !== false) return fail("explain must be false — EXPLAIN is not in Slice 1");

  // ── subject ──
  const subject = p.subject as { class?: unknown; ids?: unknown } | undefined;
  if (!subject || typeof subject !== "object") return fail("subject is required");
  if (typeof subject.class !== "string" || !(subject.class in OBJECT_CLASSES)) return fail(`unknown object class ${String(subject.class)}`);
  if (subject.ids !== undefined) {
    if (!Array.isArray(subject.ids)) return fail("subject.ids must be an array");
    for (const id of subject.ids) if (typeof id !== "string" || !UUID.test(id)) return fail("subject.ids must be canonical uuids");
  }

  // ── scope ── the EXISTING scope model; membership is resolved server-side, never declared here.
  const scope = p.scope as Scope | undefined;
  if (!scope || typeof scope !== "object") return fail("scope is required");
  if (typeof scope.kind !== "string" || !SCOPE_KINDS.has(scope.kind)) return fail(`unknown scope kind ${String(scope.kind)}`);
  if (scope.id !== null && (typeof scope.id !== "string" || scope.id.length > 128)) return fail("scope.id must be null or a short identifier");
  if (isAllScope(scope) && scope.id !== null) return fail("the ALL scope carries no id");

  // ── filters ──
  if (!Array.isArray(p.filters)) return fail("filters must be an array");
  for (const raw of p.filters as unknown[]) {
    if (typeof raw !== "object" || raw === null) return fail("each filter must be an object");
    const f = raw as Partial<Filter>;
    const def = f.dimension && (FILTERS as Record<string, unknown>)[f.dimension] ? FILTERS[f.dimension] : null;
    if (!def) return fail(`unknown filter dimension ${String(f.dimension)}`);
    if (!f.op || !def.ops.includes(f.op)) return fail(`operator ${String(f.op)} is not allowed on ${f.dimension}`);
    if (!Array.isArray(f.values) || f.values.length === 0) return fail(`filter ${f.dimension} requires values`);
    if (f.op === "=" && f.values.length !== 1) return fail(`operator = takes exactly one value on ${f.dimension}`);
    for (const v of f.values) {
      if (typeof v !== "string" || v.length === 0 || v.length > 128) return fail(`filter ${f.dimension} has an invalid value`);
      if (def.uuid && !UUID.test(v)) return fail(`filter ${f.dimension} requires canonical uuids`);
      if (def.values && !def.values.includes(v)) return fail(`value ${v} is not in the ${f.dimension} vocabulary`);
    }
  }

  // ── metrics ── id AND version must resolve; an unregistered pair is a hard failure.
  if (!Array.isArray(p.metrics)) return fail("metrics must be an array");
  for (const raw of p.metrics as unknown[]) {
    if (typeof raw !== "object" || raw === null) return fail("each metric must be an object");
    const m = raw as Partial<MetricRef>;
    if (typeof m.id !== "string" || typeof m.version !== "number") return fail("a metric needs an id and a version");
    if (!METRICS[metricKey(m as MetricRef)]) return fail(`unknown metric ${m.id}@${m.version}`);
  }

  // ── projection ──
  if (!Array.isArray(p.projection) || p.projection.length === 0) return fail("projection must name at least one field");
  for (const f of p.projection as unknown[]) {
    if (typeof f !== "string" || !(f in FIELDS)) return fail(`unknown field ${String(f)}`);
  }
  if (!(p.projection as string[]).includes("pursuit.id")) return fail("projection must include pursuit.id — a row must be identifiable");

  // ── ordering ──
  if (p.ordering !== undefined) {
    if (!Array.isArray(p.ordering)) return fail("ordering must be an array");
    for (const raw of p.ordering as unknown[]) {
      if (typeof raw !== "object" || raw === null) return fail("each ordering entry must be an object");
      const o = raw as Partial<OrderRef>;
      if (typeof o.ref !== "string" || !ORDERABLE.has(o.ref)) return fail(`unknown ordering key ${String(o.ref)}`);
      if (o.dir !== "asc" && o.dir !== "desc") return fail("ordering dir must be asc or desc");
      // Ordering by a metric requires that metric to be selected: you cannot sort by something the
      // governance layer was never asked to resolve, or the order would leak what the values are.
      if (o.ref.startsWith("metric:")) {
        const key = o.ref.slice("metric:".length);
        const selected = (p.metrics as MetricRef[]).some((m) => metricKey(m) === key);
        if (!selected) return fail(`ordering by ${o.ref} requires that metric in metrics[]`);
      }
    }
  }

  // ── limit ──
  if (p.limit !== undefined) {
    if (typeof p.limit !== "number" || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > MAX_LIMIT) {
      return fail(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
  }

  return { ok: true, plan: p as unknown as PursuitQuery };
}
