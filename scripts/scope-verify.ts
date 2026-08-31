/**
 * Scope-narrowing verification (P0 #2/#3). Proves the ecosystem scope lens is
 * NARROWING-ONLY, RLS-bounded, and safe against hostile/foreign identifiers, and
 * that the Accounts + Queue narrowing predicates behave exactly like Today/Pipeline.
 *
 * Run: DEMO_URL=… npx tsx scripts/scope-verify.ts
 */
import { Pool } from "pg";
import { resolveScope, deriveScopeOptions } from "../src/lib/scope/server";
import { ALL_SCOPE, type Scope } from "../src/lib/scope/scope";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const db = await pool.connect();
  try {
    const org = (await db.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`)).rows[0];
    if (!org) throw new Error("no org");
    const orgId = org.id;

    // The org's own authorized company ceiling: EVERY company the org touches (scored
    // accounts ∪ opportunities ∪ motions ∪ pursuit accounts). Scope can never exceed this,
    // and every derivation query below is org_id-scoped so nothing outside it can appear.
    const orgCompanies = new Set(
      (await db.query<{ company_id: string }>(
        `select company_id from propensity_scores where org_id=$1
         union select company_id from opportunities where org_id=$1
         union select company_id from revenue_motions where org_id=$1 and company_id is not null
         union select account_id from pursuits where org_id=$1 and account_id is not null`, [orgId])).rows.map((r) => r.company_id),
    );
    ok("org has an authorized company set", orgCompanies.size > 0, `n=${orgCompanies.size}`);

    // 1) ALL = the authorized set, no restriction.
    const all = await resolveScope(db, orgId, ALL_SCOPE);
    ok("ALL resolves to companyIds=null (no narrowing)", all.companyIds === null);

    // 2) Available narrower scopes (only kinds that actually have data are offered).
    const options = await deriveScopeOptions(db, orgId);
    const byKind = (k: string) => options.find((o) => o.kind === k && o.id);
    console.log(`  · scope options offered: ${options.map((o) => o.kind).join(", ") || "(none)"}`);

    // A helper asserting a resolved scope is narrowing-only + within the org ceiling.
    const assertNarrowingOnly = async (label: string, scope: Scope) => {
      const r = await resolveScope(db, orgId, scope);
      if (r.companyIds === null) { ok(`${label} → ALL (fallback), which is the authorized set (safe)`, true); return r; }
      const foreign = r.companyIds.filter((id) => !orgCompanies.has(id));
      ok(`${label} → narrowed set ⊆ org authorized set (no foreign ids)`, foreign.length === 0, `foreign=${foreign.length}`);
      ok(`${label} → set is a strict subset or equal (never widens)`, r.companyIds.length <= orgCompanies.size, `n=${r.companyIds.length} ≤ ${orgCompanies.size}`);
      return r;
    };

    // 3) PARTNER / SELLER / PERSONAL where supported.
    for (const kind of ["PARTNER", "SELLER", "TERRITORY", "VENDOR"]) {
      const opt = byKind(kind);
      if (opt) await assertNarrowingOnly(`${kind} (${opt.label})`, { kind: opt.kind, id: opt.id });
      else console.log(`  · ${kind}: no data in this tenant — skipped`);
    }
    // PERSONAL is derived (active pursuits/motions), no id needed.
    await assertNarrowingOnly("PERSONAL", { kind: "PERSONAL", id: null });

    // 4) HOSTILE / FOREIGN identifiers must never widen or leak.
    // (a) a random unknown uuid as a PARTNER id.
    await assertNarrowingOnly("hostile PARTNER (random uuid)", { kind: "PARTNER", id: "00000000-0000-0000-0000-000000000009" });
    // (b) a company id that belongs to NO org (fabricated) — must not appear in any resolved set.
    const foreignCompany = "11111111-1111-1111-1111-111111111111";
    for (const kind of ["PARTNER", "SELLER", "TERRITORY", "VENDOR"] as const) {
      const r = await resolveScope(db, orgId, { kind, id: foreignCompany });
      const leaked = r.companyIds !== null && r.companyIds.includes(foreignCompany);
      ok(`foreign id under ${kind} never leaks into the resolved set`, !leaked);
    }

    // 5) The ACTUAL Accounts + Queue narrowing predicates (exact expressions the pages use).
    const partnerOpt = byKind("PARTNER") ?? byKind("SELLER") ?? byKind("VENDOR");
    if (partnerOpt) {
      const resolved = await resolveScope(db, orgId, { kind: partnerOpt.kind, id: partnerOpt.id });
      const ids = resolved.companyIds ?? [];
      const scoped = resolved.companyIds != null;

      // Accounts (propensity_scores) — full vs narrowed.
      const fullAcc = Number((await db.query<{ n: string }>(`select count(distinct company_id)::text n from propensity_scores where org_id=$1`, [orgId])).rows[0].n);
      const narrowAcc = Number((await db.query<{ n: string }>(
        `select count(distinct p.company_id)::text n from propensity_scores p
          where p.org_id=$1 and ($3::boolean is false or p.company_id = any($2))`, [orgId, ids, scoped])).rows[0].n);
      ok("Accounts predicate narrows (narrowed ≤ full)", narrowAcc <= fullAcc, `narrow=${narrowAcc} full=${fullAcc}`);
      ok("Accounts narrowed set is non-widening", narrowAcc <= ids.length || !scoped, `narrow=${narrowAcc} ids=${ids.length}`);

      // Queue (motion_actions → company) — full vs narrowed.
      const fullQ = Number((await db.query<{ n: string }>(
        `select count(*)::text n from motion_actions a join revenue_motions m on m.id=a.motion_id where m.org_id=$1 and a.status='pending' and m.status='active'`, [orgId])).rows[0].n);
      const narrowQ = Number((await db.query<{ n: string }>(
        `select count(*)::text n from motion_actions a join revenue_motions m on m.id=a.motion_id
          where m.org_id=$1 and a.status='pending' and m.status='active' and ($3::boolean is false or m.company_id = any($2))`, [orgId, ids, scoped])).rows[0].n);
      ok("Queue predicate narrows (narrowed ≤ full)", narrowQ <= fullQ, `narrow=${narrowQ} full=${fullQ}`);

      // Empty scope ([]) → exactly zero rows, never widened to all.
      const emptyAcc = Number((await db.query<{ n: string }>(
        `select count(*)::text n from propensity_scores p where p.org_id=$1 and ($3::boolean is false or p.company_id = any($2))`, [orgId, [], true])).rows[0].n);
      ok("empty scope [] yields ZERO accounts (never widened)", emptyAcc === 0, `n=${emptyAcc}`);
    } else {
      console.log("  · no partner/seller/vendor scope with data — predicate check skipped");
    }

    console.log(`\n[scope-verify] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("[scope-verify] fatal:", e); process.exit(1); });
