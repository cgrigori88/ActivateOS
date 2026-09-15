import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Static guard (H1B-0.1, D-050): no authorization-sensitive function may end the migration chain with a
 * search_path that lets the caller's pg_temp shadow a relation or type.
 *
 * Replays every migration file in order, tracking each public function's effective search_path through
 * CREATE [OR REPLACE] FUNCTION (which resets it to the header's SET) and ALTER FUNCTION … SET / RESET. The
 * protected class is every SECURITY DEFINER function, every trigger function and every function an RLS
 * policy calls. It fails `npm test` the moment a migration reintroduces `search_path = public` (or no
 * setting) on one of them. The live-catalogue twin of this check is scripts/search-path-verify.ts.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*--/.test(l)).map((l) => l.replace(/\s--\s.*$/, "")).join("\n");
}

function normalisePath(raw: string): string {
  return raw.replace(/["']/g, "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
}

function unsafe(sp: string | null): string | null {
  if (!sp) return "no search_path";
  const parts = sp.split(",").map((s) => s.trim());
  if (parts[0] !== "pg_catalog") return "pg_catalog not first";
  if (parts.at(-1) !== "pg_temp") return "pg_temp not explicitly last";
  if (parts.slice(1, -1).some((s) => s !== "public")) return "untrusted schema in path";
  return null;
}

interface Fn { definer: boolean; sp: string | null; file: string }
const fns = new Map<string, Fn>();
const triggerFns = new Set<string>();
const policyText: string[] = [];

for (const f of files) {
  const sql = stripComments(readFileSync(join(DIR, f), "utf8"));
  // CREATE [OR REPLACE] FUNCTION public.name(…) … AS $tag$ — header attributes live before the body.
  const createRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\bas\s+\$(\w*)\$/gi;
  for (const m of sql.matchAll(createRe)) {
    const name = m[1].toLowerCase();
    const header = m[2];
    const definer = /security\s+definer/i.test(header);
    const spm = /set\s+search_path\s*(?:=|to)\s*([^\n]+?)\s*(?:\n|$)/i.exec(header);
    fns.set(name, { definer, sp: spm ? normalisePath(spm[1]) : null, file: f });
  }
  const alterRe = /alter\s+function\s+(?:public\.)?(\w+)\s*\([^)]*\)\s+(?:set\s+search_path\s*(?:=|to)\s*([^;]+);|reset\s+search_path)/gi;
  for (const m of sql.matchAll(alterRe)) {
    const cur = fns.get(m[1].toLowerCase());
    if (cur) fns.set(m[1].toLowerCase(), { ...cur, sp: m[2] ? normalisePath(m[2]) : null, file: f });
  }
  for (const m of sql.matchAll(/execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)\s*\(/gi)) triggerFns.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/create\s+policy[\s\S]*?;/gi)) policyText.push(m[0]);
}

const policyFns = new Set<string>();
for (const text of policyText) for (const m of text.matchAll(/\b(\w+)\s*\(/g)) if (fns.has(m[1].toLowerCase())) policyFns.add(m[1].toLowerCase());

const protectedNames = [...fns.entries()].filter(([n, f]) => f.definer || triggerFns.has(n) || policyFns.has(n)).map(([n]) => n).sort();

test("the protected class is found (parser sanity: every known security function is in it)", () => {
  for (const n of ["is_org_member", "org_role", "can_see_partnership", "can_see_pursuit", "grant_is_live", "grant_population_delete_guard",
    "resolve_api_key", "resolve_user_org", "app_current_org", "h1b_consent_guard", "h1b_consent_party", "partnership_settlement_rows",
    "record_broker_event", "enforce_verified_evidence", "economic_fact_assertion_guard", "stakeholder_assertion_guard"]) {
    assert.ok(protectedNames.includes(n), `${n} missing from the protected class`);
  }
  assert.ok(protectedNames.length >= 31, `only ${protectedNames.length} protected functions found`);
});

test("every authorization-sensitive function ends the migration chain with a temp-proof search_path", () => {
  const bad = protectedNames.map((n) => { const f = fns.get(n)!; const why = unsafe(f.sp); return why ? `${n} (${f.file}): ${why} — ${f.sp ?? "unset"}` : null; }).filter(Boolean);
  assert.deepEqual(bad, [], `unsafe search_path on:\n  ${bad.join("\n  ")}`);
});

test("0105's documented rollback covers exactly the functions it hardens", () => {
  const raw = readFileSync(join(DIR, "0105_h1b01_temp_schema_hardening.sql"), "utf8");
  const forward = new Set([...stripComments(raw).matchAll(/alter\s+function\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]));
  const rollback = new Set([...raw.matchAll(/^-- ROLLBACK: alter function public\.(\w+)\s*\(/gim)].map((m) => m[1]));
  assert.equal(forward.size, 31);
  assert.deepEqual([...rollback].sort(), [...forward].sort());
});

test("the guard rejects the reintroduction patterns", () => {
  assert.ok(unsafe("public"));
  assert.ok(unsafe(null));
  assert.ok(unsafe("public, pg_temp"));
  assert.ok(unsafe("pg_catalog, public"));
  assert.ok(unsafe("pg_catalog, scratch, public, pg_temp"));
  assert.equal(unsafe("pg_catalog, public, pg_temp"), null);
  assert.equal(unsafe("pg_catalog, pg_temp"), null);
});
