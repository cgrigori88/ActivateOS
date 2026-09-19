import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  definitionDigest, isPersistableComponent, toPersistedDefinition, toSurfaceSpec,
  validatePersistedDefinition, PERSISTABLE_COMPONENTS, PERSISTED_DEFINITION_VERSION,
} from "../src/lib/experience/surface/persisted";
import { COMPONENTS } from "../src/lib/experience/surface/registry";
import { compileSurface } from "../src/lib/experience/surface/compile";
import { buildContextManifest } from "../src/lib/experience/intent/context";
import type { GovernedCell, GovernedRow } from "../src/lib/experience/types";

/**
 * P7 SLICE 12 — PINNED SURFACE DEFINITIONS.
 *
 * > **A pinned surface may persist a validated presentation/query definition. It may not persist
 * > governed results, derived identities, authority, disclosure decisions or execution state.**
 *
 * The properties worth the most here are the ones about what CANNOT be stored. Those are asserted on
 * the conversion boundary and on the schema, because "we don't currently write that field" is not a
 * guarantee — a later slice adding a field to `SurfaceSpec` is exactly how it would stop being true.
 */

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PERSISTED = SRC("lib/experience/surface/persisted.ts");
const REPO = SRC("lib/experience/surface/pin-repository.ts");
const MIGRATION = readFileSync(new URL("../supabase/migrations/0114_p7_pinned_surface_definitions.sql", import.meta.url), "utf8");
/**
 * SQL comments are PROSE (§16A). This migration's own comments explain why there is no `auth.uid()`
 * policy and no visibility/metadata column — so a raw scan finds those words in the text that
 * FORBIDS them. Every structural assertion below reads stripped DDL; the prose is asserted
 * separately, on purpose.
 */
const DDL = MIGRATION.replace(/--.*$/gm, "");

const ID0 = "11111111-2222-4333-8444-555555555555";
const cell = (v: string): GovernedCell =>
  ({ visibility: "EXACT", value: v, provenance: "pursuit.account_name", existence: "AUTHORIZED" });
const row = (id: string): GovernedRow =>
  ({ objectRef: { class: "pursuit", id }, cells: { "pursuit.account_name": cell("Acme Corporation") } });
const MANIFEST = buildContextManifest([row(ID0)]);

const LIST = { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" } };
const COHORT = { component: "pursuit.cohort", bind: { operation: "ANALYZE", view: "open-pipeline-cohort" } };
const persist = (components: unknown[], layout: unknown = "stack", source: "HAND_AUTHORED" | "MODEL" = "HAND_AUTHORED") =>
  toPersistedDefinition(layout, components, source);

// ── THE FIRST VERTICAL ──────────────────────────────────────────────────────────────────────────

test("the ruled first vertical persists: SHOW ME + ANALYZE, read-only, no context", () => {
  const r = persist([LIST, COHORT]);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  if (!r.ok) return;
  assert.equal(r.definition.definitionVersion, PERSISTED_DEFINITION_VERSION);
  assert.deepEqual(r.definition.components, [
    { component: "pursuit.list", operation: "SHOW_ME", view: "open-by-value" },
    { component: "pursuit.cohort", operation: "ANALYZE", view: "open-pipeline-cohort" },
  ]);
  // The persisted form compiles through the ORDINARY certified compiler, unchanged.
  const compiled = compileSurface({
    spec: toSurfaceSpec(r.definition), manifest: MANIFEST,
    boundContextDigest: MANIFEST.digest, source: "HAND_AUTHORED",
  });
  assert.ok(compiled.ok, compiled.ok ? "" : compiled.detail);
});

// ── WHAT CANNOT BE PERSISTED ────────────────────────────────────────────────────────────────────

test("a resolved subjectId can never enter a persisted definition", () => {
  const serialized = JSON.stringify(persist([LIST, COHORT]));
  assert.ok(!serialized.includes(ID0));
  // And the conversion takes the PRE-execution spec: it has no parameter for a compiled request.
  const body = strip(PERSISTED);
  assert.ok(!/ValidatedSurfaceSpec|CompiledIntent|subjectId|intent\.request/.test(body),
    "the persisted module never names a compiled or validated shape");
});

test("a context-bound component is REFUSED, not silently stripped", () => {
  for (const c of [
    { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromContext: 0 } } },
    { component: "pursuit.destination", bind: { operation: "GO_TO", subject: { fromContext: 0 }, surface: "canonical" } },
  ]) {
    const r = persist([c]);
    assert.equal(r.ok, false, `${c.component} must be refused`);
    if (!r.ok) assert.match(r.reason, /not persistable/);
  }
  // Even attached to an otherwise persistable component, a subject is a refusal.
  const withSubject = persist([{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value", subject: { fromContext: 0 } } }]);
  assert.equal(withSubject.ok, false);
  if (!withSubject.ok) assert.match(withSubject.reason, /cannot carry subject/);
});

test("a component-derived dependency is REFUSED", () => {
  const r = persist([LIST, { component: "pursuit.explanation", bind: { operation: "EXPLAIN", subject: { fromComponent: "pursuit.list", select: "first" } } }]);
  assert.equal(r.ok, false);
  const onList = persist([{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value", select: "first" } }]);
  assert.equal(onList.ok, false, "a selector is not a persistable bind field");
});

test("an ACTION component is STRUCTURALLY non-persistable", () => {
  assert.equal(COMPONENTS["pursuit.assemble_team"].kind, "ACTION");
  assert.equal(isPersistableComponent("pursuit.assemble_team"), false);
  const r = persist([{ component: "pursuit.assemble_team", bind: { subject: { fromContext: 0 } } }]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not persistable/);
  // And the persistable set contains no ACTION component at all.
  assert.ok([...PERSISTABLE_COMPONENTS].every((k) => COMPONENTS[k].kind === "READ"));
});

test("persistability is EXHAUSTIVE — a new component forces a decision", () => {
  const body = strip(PERSISTED);
  const map = body.slice(body.indexOf("const PERSISTABILITY"), body.indexOf("export const isPersistableComponent"));
  // Every registered component is classified by name in the map, which is typed
  // Record<ComponentKey, …> — so adding a key without classifying it fails to compile.
  for (const key of Object.keys(COMPONENTS)) {
    assert.ok(map.includes(`"${key}"`), `${key} must be explicitly classified`);
  }
  assert.match(body, /Record<ComponentKey, "PERSISTABLE" \| "NOT_PERSISTABLE">/);
});

test("persistence is OPT-IN by field — an unknown bind or component field is refused", () => {
  for (const [label, c] of [
    ["future runtime field on the bind", { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value", futureField: 1 } }],
    ["future field on the component", { component: "pursuit.list", bind: { operation: "SHOW_ME", view: "open-by-value" }, futureField: 1 }],
  ] as const) {
    const r = persist([c]);
    assert.equal(r.ok, false, `${label} must be refused`);
  }
  // NEGATIVE CONTROL: the same shape without the extra field persists, so the refusals discriminate.
  assert.ok(persist([LIST]).ok);
});

test("an unregistered view or mismatched operation is refused", () => {
  assert.equal(persist([{ component: "pursuit.list", bind: { operation: "SHOW_ME", view: "everything" } }]).ok, false);
  assert.equal(persist([{ component: "pursuit.cohort", bind: { operation: "SHOW_ME", view: "open-by-value" } }]).ok, false);
  assert.equal(persist([LIST], "fullscreen").ok, false, "an unknown layout is refused");
  assert.equal(persist([]).ok, false, "an empty definition is refused");
});

// ── OPEN-TIME REVALIDATION ──────────────────────────────────────────────────────────────────────

test("a stored definition is revalidated against the CURRENT registry on load", () => {
  const saved = persist([LIST, COHORT]);
  assert.ok(saved.ok);
  if (!saved.ok) return;
  assert.ok(validatePersistedDefinition(saved.definition).ok, "a current definition loads");

  for (const [label, mutated] of [
    ["retired view", { ...saved.definition, components: [{ component: "pursuit.list", operation: "SHOW_ME", view: "retired-view" }] }],
    ["unregistered component", { ...saved.definition, components: [{ component: "pursuit.nothing", operation: "SHOW_ME", view: "open-by-value" }] }],
    ["ACTION smuggled into storage", { ...saved.definition, components: [{ component: "pursuit.assemble_team", operation: "SHOW_ME", view: "open-by-value" }] }],
    ["ANALYZE on a view with no aggregate", { ...saved.definition, components: [{ component: "pursuit.cohort", operation: "ANALYZE", view: "recently-updated" }] }],
    ["unsupported definition version", { ...saved.definition, definitionVersion: 99 }],
    ["unknown stored field", { ...saved.definition, subjectId: ID0 }],
  ] as const) {
    const r = validatePersistedDefinition(mutated);
    assert.equal(r.ok, false, `${label} must be refused on load`);
    if (!r.ok) assert.equal(r.reason, "DEFINITION_UNAVAILABLE", label);
  }
});

test("an obsolete definition is never migrated, substituted or repaired", () => {
  const body = strip(PERSISTED);
  const fn = body.slice(body.indexOf("export function validatePersistedDefinition"));
  for (const forbidden of ["??", "fallback", "nearest", "migrate", "upgrade", "default"]) {
    assert.ok(!fn.includes(forbidden), `the load validator must not contain ${forbidden}`);
  }
  assert.match(fn, /DEFINITION_UNAVAILABLE/);
});

// ── DEFINITION IDENTITY ─────────────────────────────────────────────────────────────────────────

test("definitionDigest is stable, domain-separated, and NOT surfaceSpecDigest", () => {
  const a = persist([LIST, COHORT]);
  const b = persist([LIST, COHORT]);
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(definitionDigest(a.definition), definitionDigest(b.definition), "stable across identical saves");
  assert.match(definitionDigest(a.definition), /^[0-9a-f]{16}$/);
  assert.match(strip(PERSISTED), /"p7s12\.definition"/, "the digest input is domain-separated");

  // A different definition is a different identity.
  const c = persist([LIST]);
  assert.ok(c.ok);
  if (c.ok) assert.notEqual(definitionDigest(a.definition), definitionDigest(c.definition));

  // It is NOT the execution digest: the persisted module never computes or stores one.
  const body = strip(PERSISTED);
  assert.ok(!/surfaceSpecDigest|executionDigest/.test(body));
});

test("display metadata cannot change definitionDigest — a rename is metadata only", () => {
  const a = persist([LIST, COHORT]);
  assert.ok(a.ok);
  if (!a.ok) return;
  // The digest covers version, layout and components only — there is no name in the digest input.
  const input = strip(PERSISTED).slice(strip(PERSISTED).indexOf("export function definitionDigest"));
  assert.ok(!/name/.test(input), "the digest input contains no display metadata");
  assert.match(input, /d\.definitionVersion, d\.layout/);
  // And the repository's rename statement touches name and updated_at only.
  const rename = strip(REPO).slice(strip(REPO).indexOf("export async function renamePin"));
  assert.match(rename, /set name = \$4, updated_at = now\(\)/);
  assert.ok(!/definition\s*=|definition_digest\s*=/.test(rename), "rename never rewrites the definition or digest");
});

test("the persisted definition carries NO execution or authority material", () => {
  const r = persist([LIST, COHORT], "stack", "MODEL");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.definition).sort(), ["components", "definitionVersion", "layout", "source"]);
  // Asserted on the FIELD NAMES, not on a substring scan of the serialized bytes: a registered view
  // key is legitimately called `open-by-value`, and a scan for "value" would fail on the data the
  // definition is SUPPOSED to carry.
  const fields = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { fields.add(k.toLowerCase()); walk(x); }
  };
  walk(r.definition);
  for (const forbidden of ["principal", "role", "authorized", "disclosure", "digest", "manifest",
                           "context", "subject", "subjectid", "result", "rows", "approval", "action"]) {
    assert.ok(!fields.has(forbidden), `a persisted definition must not carry a ${forbidden} field`);
  }
  assert.deepEqual([...fields].sort(), ["component", "components", "definitionversion", "layout", "operation", "source", "view"]);
  // `source` is audit metadata and is explicitly not read for authority.
  assert.equal(r.definition.source, "MODEL");
});

// ── THE REPOSITORY IS THE ONLY PRODUCTION PATH ──────────────────────────────────────────────────

test("EVERY production reader/writer of the pin table is the repository — INVENTORY", () => {
  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  });
  walk(new URL("../src", import.meta.url).pathname);
  const direct = files.filter((f) => /pinned_surface_definitions/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(f.indexOf("src/"))).sort();
  assert.deepEqual(direct, ["src/lib/experience/surface/pin-repository.ts"],
    "a new direct reader/writer of the pin table appeared — classify it before shipping");
});

test("every repository statement constrains by org AND creator", () => {
  const body = strip(REPO);
  const statements = body.match(/from pinned_surface_definitions[\s\S]*?\[/g) ?? [];
  assert.ok(statements.length >= 3, "the read/rename/delete statements were located");
  // Every statement that selects, updates or deletes names both predicates.
  for (const kind of ["select id, name, definition_digest, created_at", "update pinned_surface_definitions", "delete from pinned_surface_definitions", "select id, name, definition, definition_digest"]) {
    const at = body.indexOf(kind);
    assert.ok(at > 0, `${kind} exists`);
    const stmt = body.slice(at, at + 400);
    assert.match(stmt, /org_id = \$1/, `${kind} constrains by org`);
    assert.match(stmt, /created_by_user_id = \$2/, `${kind} constrains by creator`);
  }
});

test("creator identity is never accepted from a caller", () => {
  const body = strip(REPO);
  // The only source of a creator is the `principalUserId` parameter the caller's boundary derived.
  assert.ok(!/formData|searchParams|request\.|body\.|params\./.test(body), "nothing caller-shaped enters the repository");
  assert.match(body, /createPin\(\s*\n?\s*principalUserId: string/);
  // The org never comes from a parameter either — it comes from the session via withTenant.
  assert.match(body, /withTenant\(async \(db, orgId\)/);
  assert.ok(!/orgId: string/.test(body), "no caller may nominate an organization");
});

test("a missing pin and a foreign pin are the SAME answer", () => {
  const body = strip(REPO);
  const load = body.slice(body.indexOf("export async function loadPin"), body.indexOf("export async function renamePin"));
  assert.match(load, /if \(!rows\[0\]\) return \{ ok: false as const, error: "NOT_AVAILABLE" as const \}/);
  // The query cannot distinguish them: both predicates are in the same WHERE clause.
  assert.match(load, /where org_id = \$1 and created_by_user_id = \$2 and id = \$3/);
});

test("NEGATIVE CONTROL: dropping the creator predicate would be CAUGHT", () => {
  const check = (src: string) => {
    const b = strip(src);
    const load = b.slice(b.indexOf("export async function loadPin"), b.indexOf("export async function renamePin"));
    return /created_by_user_id = \$2/.test(load);
  };
  assert.equal(check(REPO), true, "canonical code passes");
  const leaky = REPO.replace("where org_id = $1 and created_by_user_id = $2 and id = $3",
                             "where org_id = $1 and id = $3");
  assert.notEqual(leaky, REPO, "the mutation actually applied");
  assert.equal(check(leaky), false, "an org-only predicate is caught");
});

// ── THE SCHEMA MAKES THE FORBIDDEN CONTENT UNREPRESENTABLE ──────────────────────────────────────

test("the migration creates exactly the ruled columns and nothing else", () => {
  const table = DDL.slice(DDL.indexOf("create table if not exists pinned_surface_definitions"), DDL.indexOf(");"));
  const cols = [...table.matchAll(/^\s{2}([a-z_]+)\s+\S/gm)].map((m) => m[1]);
  assert.deepEqual(cols.sort(), [
    "created_at", "created_by_user_id", "definition", "definition_digest",
    "definition_schema_version", "id", "name", "org_id", "updated_at",
  ]);
});

test("the schema has NO column for results, identity, authority or execution state", () => {
  const table = DDL.slice(DDL.indexOf("create table"), DDL.indexOf(");"));
  for (const forbidden of ["subject", "context", "manifest", "execution_digest", "result", "rows",
                           "principal", "role", "authority", "disclosure", "approval", "action",
                           "deleted_at", "archived_at", "revision", "supersed", "shared", "visibility", "metadata"]) {
    assert.ok(!table.includes(forbidden), `the schema must have no ${forbidden} column`);
  }
});

test("RLS enforces ORGANIZATION isolation with the canonical predicate", () => {
  assert.match(DDL, /alter table pinned_surface_definitions enable row level security/);
  assert.match(DDL, /alter table pinned_surface_definitions force row level security/);
  assert.match(DDL, /using \(is_org_member\(org_id\)\) with check \(is_org_member\(org_id\)\)/);
  // The POLICY does not attempt the auth.uid() predicate that is known to reject the app_rw path.
  assert.ok(!/auth\.uid\(\)/.test(DDL), "no user-scoped policy that would deny every request");
  // NEGATIVE CONTROL: the phrase IS in the migration — as the comment explaining why it is absent.
  assert.match(MIGRATION, /auth\.uid\(\)/, "the forbidding prose exists outside the DDL");
});

test("the asymmetry is recorded where it is enforced, not just in a document", () => {
  // A future reader must not mistake creator visibility for a database guarantee.
  assert.match(MIGRATION, /NOT an RLS predicate/);
  assert.match(strip(REPO).length > 0 ? REPO : "", /not RLS-enforced|NOT \*\*RLS-enforced|\*\*not\*\* RLS-enforced/i);
});

// ── NO MODEL, NO WRITE ELSEWHERE ────────────────────────────────────────────────────────────────

test("saving and opening require NO provider call", () => {
  for (const [name, code] of [["persisted", PERSISTED], ["repository", REPO]] as const) {
    const body = strip(code);
    for (const forbidden of ["proposeSurface", "proposeIntent", "completeStructured", "ai/client", "anthropic"]) {
      assert.ok(!body.includes(forbidden), `${name} must not reach a provider`);
    }
  }
  const route = strip(SRC("app/experience/pursuits/page.tsx"));
  const open = route.slice(route.indexOf("async function OpenPinView"), route.indexOf("function ActionAffordance"));
  assert.ok(open.length > 100, "the open path was located");
  assert.ok(!/proposeSurface|proposeIntent|compose/.test(open), "opening a pin never calls a model");
  assert.match(open, /source: "HAND_AUTHORED"/, "a saved definition executes deterministically whatever produced it");
});

test("opening derives a FRESH principal and re-governs", () => {
  const route = strip(SRC("app/experience/pursuits/page.tsx"));
  const open = route.slice(route.indexOf("async function OpenPinView"), route.indexOf("function ActionAffordance"));
  assert.match(open, /const principal = await currentPrincipal\(\)/, "the creator principal is derived at open");
  // SLICE 13. Compilation and assembly moved into the one canonical executor, so the property is
  // asserted where it now lives rather than deleted. A pin is an ordinary certified request: there
  // is no parallel execution path for persisted definitions.
  assert.match(open, /await executeExperience\(/, "the definition executes through the canonical executor");
  assert.match(open, /await webSessionPrincipal\(\)/, "under a freshly resolved execution principal");
  const executor = strip(SRC("lib/experience/surface/execute-experience.ts"));
  assert.match(executor, /compileSurface\(/, "and the executor compiles it fresh");
  assert.match(executor, /assembleSurface\(compiled\.validated, principal\)/, "and assembles under that principal");
});

test("the pin path writes nothing outside its own table", () => {
  const body = strip(REPO);
  const tables = [...body.matchAll(/(?:from|into|update)\s+([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ["pinned_surface_definitions"], tables.join(", "));
  for (const forbidden of ["dispatchSkill", "startAndRun", "pursuits set", "change_ledger"]) {
    assert.ok(!body.includes(forbidden), `the repository must not touch ${forbidden}`);
  }
});

// ── THE LIFECYCLE MUTATIONS: RENAME AND HARD DELETE ─────────────────────────────────────────────
//
// > **Opening/rendering a pin is read-only. Rename and delete require explicit user mutation intent.**
//
// The property these tests exist for is NOT "rename works". It is that a GET cannot rename or delete
// — because a render is issued by crawlers, prefetchers and link previews, and durable state must
// not be destroyable by anything that merely follows a URL.

const ACTIONS = SRC("app/experience/pursuits/pin-actions.ts");
const PAGE = SRC("app/experience/pursuits/page.tsx");

test("rename and delete exist as explicit POST-only server actions", () => {
  assert.match(ACTIONS.split("\n")[0], /^"use server";$/, "the module is a server-action module");
  const body = strip(ACTIONS);
  assert.match(body, /export async function renamePinnedSurface\(formData: FormData\)/);
  assert.match(body, /export async function deletePinnedSurface\(formData: FormData\)/);
  // A server action is POST-only by construction; the forms that reach it are the only entry points.
  assert.match(strip(PAGE), /<form action=\{renamePinnedSurface\}/);
  assert.match(strip(PAGE), /<form action=\{deletePinnedSurface\}/);
});

test("NO GET/render path can rename or delete", () => {
  const page = strip(PAGE);
  // 1. The route accepts no rename/delete search parameter at all.
  const params = page.slice(page.indexOf("searchParams: Promise<{"), page.indexOf("}>;") + 3);
  for (const forbidden of ["rename", "delete", "remove", "forget", "destroy"]) {
    assert.ok(!params.includes(forbidden), `?${forbidden}= must not be a route parameter`);
  }
  // 2. The render path never CALLS a mutating function — the actions appear only as form targets.
  for (const fn of ["renamePinnedSurface", "deletePinnedSurface"]) {
    const called = new RegExp(`(?:await\\s+)?${fn}\\s*\\(`).test(page);
    assert.equal(called, false, `${fn} must never be invoked during render`);
    assert.match(page, new RegExp(`action=\\{${fn}\\}`), `${fn} is reachable only as a form action`);
  }
  // 3. No render-path module reaches the mutating repository functions directly.
  assert.ok(!/\brenamePin\b|\bdeletePin\b/.test(page), "the page never calls the repository mutators itself");
});

test("the lifecycle actions derive principal and org SERVER-SIDE, and accept neither", () => {
  const body = strip(ACTIONS);
  // The PROPERTY is "the creator is derived server-side", not any particular call syntax.
  assert.match(body, /from "\.\/binding"/, "the principal comes from the server-only binding module");
  assert.match(body, /currentPrincipal\(\)/, "the creator is derived, never supplied");
  // The org is never named at all here: it arrives inside the repository via withTenant.
  assert.ok(!/orgId|org_id/.test(body), "no organization may be nominated by a caller");
  assert.ok(!/created_by|creator/.test(body.replace(/currentPrincipal/g, "")), "no creator may be nominated");
  // Exactly two values are read from the request, and they are the two the ruling allows.
  const keys = [...body.matchAll(/formData\.get\("([a-z]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(keys)], ["id", "name"], `only the pin id and display name are accepted: ${keys}`);
  // Nothing semantic can arrive: there is no path for definition bytes or a digest.
  for (const forbidden of ["definition", "digest", "components", "layout", "source", "specVersion"]) {
    assert.ok(!body.includes(forbidden), `the action must not accept ${forbidden}`);
  }
});

test("the lifecycle actions write ONLY through the ruled repository", () => {
  const body = strip(ACTIONS);
  assert.match(body, /from "@\/lib\/experience\/surface\/pin-repository"/, "it uses the one persistence module");
  assert.ok(!body.includes("pinned_surface_definitions"), "it never names the table — no second persistence path");
  assert.ok(!/getPool|PoolClient|db\.query|withTenant/.test(body), "it issues no SQL of its own");
  // And it re-asks the same two gates the read path passes, so a mutation cannot outlive the feature.
  assert.match(body, /pursuitExperienceEnabled\(\)/);
  assert.match(body, /dynamicSurfacesEnabled\(\)/);
});

test("rename is metadata only — it cannot reach the definition or its digest", () => {
  const body = strip(ACTIONS);
  const rename = body.slice(body.indexOf("export async function renamePinnedSurface"), body.indexOf("export async function deletePinnedSurface"));
  assert.match(rename, /await renamePin\(principal, id, name\)/, "it calls the scoped repository rename");
  assert.ok(!/deletePin|createPin|loadPin/.test(rename), "rename reaches no other operation");
  // The repository statement it reaches sets name and updated_at and nothing else.
  const stmt = strip(REPO).slice(strip(REPO).indexOf("update pinned_surface_definitions"));
  assert.match(stmt.slice(0, 200), /set name = \$4, updated_at = now\(\)/);
  assert.ok(!/definition\s*=/.test(stmt.slice(0, 200)), "the definition column is not in the rename statement");
  assert.ok(!/definition_digest\s*=/.test(stmt.slice(0, 200)), "the digest column is not in the rename statement");
});

test("delete is a hard delete of the owned row only", () => {
  const body = strip(ACTIONS);
  const del = body.slice(body.indexOf("export async function deletePinnedSurface"));
  assert.match(del, /await deletePin\(principal, id\)/);
  assert.ok(!/renamePin|createPin/.test(del), "delete reaches no other operation");
  const stmt = strip(REPO).slice(strip(REPO).indexOf("delete from pinned_surface_definitions"));
  assert.match(stmt.slice(0, 200), /where org_id = \$1 and created_by_user_id = \$2 and id = \$3/);
  // No tombstone, no archive, no recovery.
  for (const forbidden of ["deleted_at", "archived", "tombstone", "restore", "undelete"]) {
    assert.ok(!REPO.includes(forbidden) && !DDL.includes(forbidden), `no ${forbidden} state exists`);
  }
});

test("neither outcome is distinguishable — a peer cannot probe existence through the mutation boundary", () => {
  const body = strip(ACTIONS);
  // Both actions redirect to a fixed destination regardless of whether anything happened.
  assert.match(body, /redirect\(`\/experience\/pursuits\?open=\$\{id\}`\)/);
  assert.match(body, /redirect\("\/experience\/pursuits"\)/);
  // No branch reports the repository's outcome back to the caller.
  assert.ok(!/NOT_AVAILABLE|error:|\.ok \?/.test(body), "the action surfaces no distinguishing outcome");
});

test("NEGATIVE CONTROL: a ?rename= route parameter would be CAUGHT", () => {
  const check = (src: string) => {
    const page = strip(src);
    const params = page.slice(page.indexOf("searchParams: Promise<{"), page.indexOf("}>;") + 3);
    return !["rename", "delete"].some((k) => params.includes(k));
  };
  assert.equal(check(PAGE), true, "canonical code passes");
  const leaky = PAGE.replace("open?: string }>;", "open?: string; rename?: string }>;");
  assert.notEqual(leaky, PAGE, "the mutation actually applied");
  assert.equal(check(leaky), false, "a rename search parameter is caught");
});

test("NEGATIVE CONTROL: invoking a lifecycle action during render would be CAUGHT", () => {
  const check = (src: string) => !/(?:await\s+)?deletePinnedSurface\s*\(/.test(strip(src));
  assert.equal(check(PAGE), true, "canonical code passes");
  const leaky = PAGE.replace(
    "  return <SurfaceRender result={assembled.result} lifecycle=",
    "  await deletePinnedSurface(new FormData());\n  return <SurfaceRender result={assembled.result} lifecycle=");
  assert.notEqual(leaky, PAGE, "the mutation actually applied");
  assert.equal(check(leaky), false, "a render-time invocation is caught");
});

test("NEGATIVE CONTROL: a rename that mutated definition bytes would be CAUGHT", () => {
  const check = (src: string) => {
    const stmt = strip(src).slice(strip(src).indexOf("update pinned_surface_definitions"), strip(src).indexOf("update pinned_surface_definitions") + 200);
    return !/definition\s*=/.test(stmt);
  };
  assert.equal(check(REPO), true, "canonical code passes");
  const leaky = REPO.replace("set name = $4, updated_at = now()", "set name = $4, definition = $5, updated_at = now()");
  assert.notEqual(leaky, REPO, "the mutation actually applied");
  assert.equal(check(leaky), false, "a definition write inside rename is caught");
});

test("NEGATIVE CONTROL: a lifecycle action reaching a canonical table would be CAUGHT", () => {
  const check = (src: string) => {
    const tables = [...strip(src).matchAll(/(?:from|into|update|delete from)\s+([a-z_]+)/g)].map((m) => m[1]);
    return [...new Set(tables)].every((t) => t === "pinned_surface_definitions");
  };
  assert.equal(check(REPO), true, "canonical code passes");
  const leaky = REPO.replace("delete from pinned_surface_definitions",
                             "delete from pursuits where 1=0; delete from pinned_surface_definitions");
  assert.notEqual(leaky, REPO, "the mutation actually applied");
  assert.equal(check(leaky), false, "a canonical-table write is caught");
});

test("the access-path inventory now covers the lifecycle module too", () => {
  // pin-actions.ts must reach the table ONLY through the repository, so it must not name the table.
  assert.ok(!ACTIONS.includes("pinned_surface_definitions"));
  // And the repository's importers are a closed, classified set.
  const files: string[] = [];
  const walk = (dir: string) => readdirSync(dir).forEach((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p);
  });
  walk(new URL("../src", import.meta.url).pathname);
  const importers = files.filter((f) => /pin-repository/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(f.indexOf("src/"))).sort()
    .filter((f) => f !== "src/lib/experience/surface/pin-repository.ts");
  assert.deepEqual(importers, [
    "src/app/experience/pursuits/page.tsx",
    "src/app/experience/pursuits/pin-actions.ts",
  ], "a new importer of the persistence module appeared — classify it before shipping");
});
