/**
 * Pilot Readiness Rehearsal — the three-organization authenticated proof driven
 * through the ACTUAL application/runtime boundary (the running Next server over
 * HTTP), not a standalone library harness.
 *
 * One canonical hero Pursuit, three organizations, three disclosure-appropriate
 * projections, each resolved by fetching the real served page from the booted app:
 *
 *   Vendor (sponsor)       → 200, the confidential figure "1.84M" IS in the payload
 *   Distributor (participant) → 200, the confidential figure is ABSENT; participant
 *                               projection ("Shared context…") is served instead
 *   Outsider (guest)       → 404, the Pursuit's existence is hidden (T11)
 *
 * Disclosure is proven at the SERVED-PAYLOAD boundary — what actually leaves the
 * server — not by client-side hiding. The viewer org is switched the way the demo
 * boot resolves identity (sole-org = earliest-created), by toggling created_at.
 *
 * Prerequisites: pursuit_demo built (scripts/demo-db.ts) and the app booted:
 *   DATABASE_URL=postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo \
 *   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= \
 *   PURSUITS_ENABLED=1 FACTS_ENABLED=1 ROUTING_ENABLED=1 PURSUIT_EXPERIENCE_ENABLED=1 \
 *   PORT=3100 npx next dev -p 3100
 *
 *   BASE=http://127.0.0.1:3100 npx tsx scripts/pilot-readiness-rehearsal.ts
 */
import { Pool } from "pg";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const ADMIN = process.env.DEMO_ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const HERO = process.env.HERO ?? "970b83d0-4aa4-45f7-a839-bf48b59bd287";
const CONF_HUMAN = "1.84M";      // the confidential figure as the sponsor payload renders it
const CONF_RAW = "1840000";      // the raw figure must NEVER reach any client
const pool = new Pool({ connectionString: ADMIN, max: 1 });

let passed = 0, failed = 0; const failures: string[] = [];
function check(n: string, c: boolean, d = "") { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; failures.push(n + (d ? ` — ${d}` : "")); console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/pursuits", { redirect: "manual" }); if (r.status < 500) return true; } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

/** Make `orgId` the earliest-created org (the demo viewer), others strictly later. */
async function setViewer(orgId: string, allOrgs: string[]) {
  await pool.query(`update organizations set created_at = '2000-01-01T00:00:00Z' where id = $1`, [orgId]);
  let n = 1;
  for (const o of allOrgs) if (o !== orgId) { await pool.query(`update organizations set created_at = $2 where id = $1`, [o, new Date(Date.UTC(2001, 0, 1) + n * 3600_000).toISOString()]); n++; }
}

async function fetchHero(): Promise<{ status: number; body: string }> {
  const r = await fetch(`${BASE}/pursuits/${HERO}`, { redirect: "manual" });
  const body = await r.text().catch(() => "");
  return { status: r.status, body };
}

async function main() {
  console.log(`[pilot-readiness-rehearsal] app=${BASE} db=pursuit_demo hero=${HERO}`);
  if (!(await waitForServer())) { console.error("app did not become ready on " + BASE); process.exit(3); }

  // Resolve the three roles from the live schema (not hard-coded ids).
  const orgs = (await pool.query<{ id: string; name: string; kind: string; created_at: Date }>(`select id, name, kind, created_at from organizations order by created_at asc`)).rows;
  const heroOrg = (await pool.query<{ org_id: string }>(`select org_id from pursuits where id=$1`, [HERO])).rows[0]?.org_id;
  const parts = (await pool.query<{ org_id: string; role_key: string; participation_state: string }>(`select org_id, role_key, participation_state from pursuit_participants where pursuit_id=$1`, [HERO])).rows;
  const vendor = heroOrg;
  const distributor = parts.find((p) => p.org_id !== vendor && p.participation_state === "ACTIVE")?.org_id;
  const outsider = orgs.find((o) => o.id !== vendor && o.id !== distributor)?.id;
  check("hero pursuit has a sponsor org, an ACTIVE participant, and a non-participant org exist", !!vendor && !!distributor && !!outsider, `vendor=${vendor} dist=${distributor} outsider=${outsider}`);
  if (!vendor || !distributor || !outsider) { await pool.end(); process.exit(1); }
  const allIds = orgs.map((o) => o.id);
  const original = new Map(orgs.map((o) => [o.id, o.created_at] as const));

  try {
    // ---- Vendor (sponsor) viewpoint ----
    console.log("PRR.1  Vendor (sponsor) — full decision surface, confidential figure served");
    await setViewer(vendor, allIds);
    const v = await fetchHero();
    check("sponsor loads the hero pursuit (200) through the running app", v.status === 200, `status ${v.status}`);
    check("the confidential figure IS in the sponsor's served payload (1.84M)", v.body.includes(CONF_HUMAN), v.body.includes(CONF_HUMAN) ? "" : "figure absent");
    check("the RAW confidential figure never reaches the client (humanized only)", !v.body.includes(CONF_RAW));

    // ---- Distributor (participant) viewpoint ----
    console.log("PRR.2  Distributor (participant) — disclosure-safe projection, figure suppressed");
    await setViewer(distributor, allIds);
    const d = await fetchHero();
    check("participant loads the SAME pursuit (200)", d.status === 200, `status ${d.status}`);
    check("the confidential figure is ABSENT from the participant payload (suppressed)", !d.body.includes(CONF_HUMAN) && !d.body.includes(CONF_RAW));
    // The participant branch renders the disclosure-safe federation projection ("participant view"),
    // NOT the sponsor's decision surface — a differential the sponsor payload does not carry.
    check("the participant is served the disclosure-safe participant projection, not the sponsor surface", /participant view/i.test(d.body) && !/participant view/i.test(v.body), /participant view/i.test(d.body) ? "" : "no participant projection marker");

    // ---- Outsider (guest) viewpoint ----
    console.log("PRR.3  Outsider (non-participant) — existence hidden (T11)");
    await setViewer(outsider, allIds);
    const o = await fetchHero();
    check("a non-participant org gets 404 — the pursuit's existence is hidden", o.status === 404, `status ${o.status}`);
    check("no confidential figure in a 404 body", !o.body.includes(CONF_HUMAN) && !o.body.includes(CONF_RAW));

    // Disclosure is at the served-payload boundary: same pursuit, three different payloads.
    check("ONE canonical pursuit yielded three distinct disclosure-appropriate responses", v.status === 200 && d.status === 200 && o.status === 404 && v.body.includes(CONF_HUMAN) && !d.body.includes(CONF_HUMAN));
  } finally {
    for (const [id, ts] of original) await pool.query(`update organizations set created_at=$2 where id=$1`, [id, ts]).catch(() => {});
  }

  console.log(`\n[pilot-readiness-rehearsal] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[pilot-readiness-rehearsal] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[pilot-readiness-rehearsal] fatal:", e); pool.end(); process.exit(2); });
