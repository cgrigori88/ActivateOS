import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Pool } from "pg";

/**
 * Local rehearsal of the H1B runtime cutover (H1A — evidence for the H1B design; no hosted change).
 *
 * THE QUESTION. If the web runtime connected as `app_rw` (the least-privilege role RLS binds) instead
 * of the table owner, which rooms would behave differently? A room that renders the same under both is
 * already correct without the owner's RLS bypass. A room that differs, empties or errors is a path that
 * still DEPENDS on the bypass — it must be understood before H1B.
 *
 * HOW. The canonical world is cloned (template) and the real production build is started twice against
 * the clone: once with `DATABASE_URL` = the owner, once with `DATABASE_URL` = `app_rw` and
 * `DATABASE_URL_OWNER` = the owner (exactly the H1B split). Every room is crawled under both, and the
 * visible text is compared line by line (clock-driven phrases normalised).
 *
 * LOCAL ONLY. `app_rw` has a local LOGIN (password `demo`, set by scripts/demo-db.ts for local boot).
 * This script changes no role, grant or policy, and the clone is dropped afterwards.
 *
 *   npx tsx scripts/app-rw-rehearsal.ts            (needs `npm run build` first)
 */

const SRC = process.env.SEEDED_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const ADMIN = process.env.ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const PORT = Number(process.env.REHEARSAL_PORT ?? 3198);
const BASE = `http://127.0.0.1:${PORT}`;
const CLONE = `v_app_rw_rehearsal_${Date.now().toString(36)}`;
// One-off token so the rehearsal can read /api/build's runtime posture (H1B Gate 6) from the running app.
const OPS_TOKEN = `rehearsal-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** The running app's own report of its database posture (/api/build → database.*). */
async function posture(): Promise<{ role?: string; bypassRls?: boolean | null; tenantEnforcement?: boolean | null; probe?: string; projectRef?: string } | null> {
  try {
    const r = await fetch(`${BASE}/api/build`, { headers: { "x-ops-token": OPS_TOKEN }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    return ((await r.json()) as { database?: Record<string, never> }).database ?? null;
  } catch { return null; }
}

const TIMEISH = /\b\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|w|mo|y)\s+ago\b|\bjust now\b|\b\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago\b|\bin \d+\s*(?:s|m|h|d|minutes?|hours?|days?)\b|\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?|\b20\d\d-\d\d-\d\dT[\d:.]+Z?/g;
const lines = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, "\n").replace(/<style[\s\S]*?<\/style>/gi, "\n").replace(/<[^>]+>/g, "\n")
  .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
  .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).map((l) => l.replace(TIMEISH, "⌚"));

function urlFor(db: string, user?: string, pass?: string): string {
  const u = new URL(SRC);
  u.pathname = `/${db}`;
  if (user) { u.username = user; u.password = pass ?? ""; }
  return u.toString();
}

async function start(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env: {
      ...process.env, NODE_ENV: "production", PORT: String(PORT), BASIC_AUTH_USER: "", BASIC_AUTH_PASS: "",
      NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", OUTREACH_AUTOSEND: "", RESEND_API_KEY: "",
      PURSUITS_ENABLED: "true", FACTS_ENABLED: "true", ROUTING_ENABLED: "true", PURSUIT_EXPERIENCE_ENABLED: "true",
      OUTCOME_LEARNING_ENABLED: "true", FEDERATION_ENABLED: "true", GOVERNED_ACTION_ENABLED: "true",
      VNEXT_PURSUIT_COORDINATION_ENABLED: "true", VNEXT_PURSUIT_ATTENTION_ENABLED: "true",
      OPS_FINGERPRINT_TOKEN: OPS_TOKEN, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => { log += d; });
  child.stderr?.on("data", (d) => { log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    try { const r = await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return child; } catch { /* not up */ }
    if (child.exitCode != null) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  child.kill("SIGTERM");
  throw new Error(`app did not start: ${log.slice(-500)}`);
}

async function stop(child: ChildProcess): Promise<void> {
  child.kill("SIGTERM");
  await new Promise((r) => { child.once("exit", r); setTimeout(r, 5000); });
}

async function crawl(rooms: string[]): Promise<Map<string, { status: number; lines: string[] }>> {
  const out = new Map<string, { status: number; lines: string[] }>();
  for (const r of rooms) {
    try {
      const res = await fetch(BASE + r, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      const body = await res.text();
      out.set(r, { status: res.status, lines: r.startsWith("/api/") || r.startsWith("/accounts/export") ? body.split("\n") : lines(body) });
    } catch (e) { out.set(r, { status: 0, lines: [String(e)] }); }
  }
  return out;
}

interface ConsentFixture { jointPursuit: string; company: string; expect: [room: string, marker: string, what: string][] }

/**
 * Seed, on the rehearsal clone only, one of each counterpart → sponsor consent artefact the sponsor's
 * rooms render: an accepted evidence share (account timeline), an accepted skill share (/skills), an
 * accepted + materialised list grant (/admin), the counterpart's and the broker's lines in the joint
 * room, and a counterpart closed-won deal on the jointly pursued account (settlement on /joint).
 * Returns null (and the rehearsal runs without it) if the canonical partnership / joint pursuit is absent.
 */
async function consentFixture(q: Pool, sponsor: string): Promise<ConsentFixture | null> {
  const row = async <T,>(sql: string, p: unknown[] = []) => (await q.query(sql, p)).rows[0] as T | undefined;
  const ps = await row<{ id: string; other: string }>(
    `select id, case when initiator_org_id = $1 then counterpart_org_id else initiator_org_id end as other
       from partnerships where status = 'active' and counterpart_org_id is not null and $1 in (initiator_org_id, counterpart_org_id) limit 1`, [sponsor]);
  const jp = ps ? await row<{ id: string; company_id: string }>(`select id, company_id from joint_pursuits where partnership_id = $1 and status = 'active' limit 1`, [ps.id]) : undefined;
  if (!ps || !jp) return null;
  const T = ps.other;
  const ev = await row<{ id: string }>(
    `insert into evidence select (jsonb_populate_record(null::evidence, to_jsonb(e) || jsonb_build_object(
        'id', gen_random_uuid(), 'org_id', $1::uuid, 'company_id', $2::uuid, 'claim', 'H1B0FX counterpart field claim',
        'claim_fingerprint', 'h1b0fx-' || gen_random_uuid()))).*
       from evidence e where e.status = 'verified' limit 1 returning id`, [T, jp.company_id]);
  await q.query(`insert into evidence_shares (evidence_id, partnership_id, offered_by_org, status, decided_at) values ($1, $2, $3, 'accepted', now())`, [ev!.id, ps.id, T]);
  const sk = await row<{ id: string }>(`insert into skills (org_id, name, kind, scope_type, body, status, created_by)
      values ($1, 'H1B0FX counterpart positioning', 'positioning', 'org', 'H1B0FX shared skill body', 'active', 'h1b0-fixture') returning id`, [T]);
  await q.query(`insert into skill_shares (skill_id, partnership_id, status, decided_at) values ($1, $2, 'accepted', now())`, [sk!.id, ps.id]);
  const src = await row<{ id: string }>(`insert into account_populations (org_id, name, category, status, created_by)
      values ($1, 'H1B0FX counterpart coverage list', 'target', 'approved', 'h1b0-fixture') returning id`, [T]);
  await q.query(`insert into population_members (population_id, company_id, attributes) values ($1, $2, '{}'::jsonb)`, [src!.id, jp.company_id]);
  const cp = await row<{ id: string }>(`insert into account_populations (org_id, name, category, status, created_by)
      values ($1, 'H1B0FX counterpart coverage list (shared)', 'target', 'approved', 'partner share') returning id`, [sponsor]);
  await q.query(`insert into population_members (population_id, company_id, attributes) values ($1, $2, '{}'::jsonb)`, [cp!.id, jp.company_id]);
  await q.query(`insert into list_grants (partnership_id, from_org_id, population_id, status, decided_at, synced_at, materialized_population_id)
      values ($1, $2, $3, 'accepted', now(), now(), $4)`, [ps.id, T, src!.id, cp!.id]);
  await q.query(`insert into joint_pursuit_events (pursuit_id, org_id, actor, kind, body) values ($1, $2, 'counterpart@example.invalid', 'note', 'H1B0FX counterpart room note')`, [jp.id, T]);
  await q.query(`insert into joint_pursuit_events (pursuit_id, org_id, actor, kind, body) values ($1, null, 'broker', 'proposal', 'H1B0FX broker proposal line')`, [jp.id]);
  await q.query(`insert into opportunities (org_id, company_id, name, stage, amount_usd, closed_at) values ($1, $2, 'H1B0FX counterpart won deal', 'closed_won', 987000, now())`, [T, jp.company_id]);
  return {
    jointPursuit: jp.id, company: jp.company_id,
    expect: [
      [`/joint/${jp.id}`, "H1B0FX counterpart room note", "joint-room line"],
      [`/joint/${jp.id}`, "H1B0FX broker proposal line", "broker line"],
      ["/joint", "987", "settlement deal (both books)"],
      ["/skills", "H1B0FX counterpart positioning", "shared skill"],
      [`/accounts/${jp.company_id}`, "H1B0FX counterpart field claim", "shared evidence claim"],
      ["/admin", "H1B0FX counterpart coverage list", "incoming list grant"],
    ],
  };
}

/**
 * D-G5-1 ordering fixture (on the CLONE only): seven qualifying "stage vs engagement" / stale deals with
 * IDENTICAL updated_at, older than every canonical one so they fill the capped slots, inserted in
 * DESCENDING id order so physical order is the reverse of the key order. Today, the drawer and View All
 * then render a capped list whose content depends entirely on tie-breaking — so the exact line-by-line
 * owner-vs-app_rw comparison below proves the tie is resolved identically under both roles. (The
 * canonical world already carries a created_at tie between two lists on one renewal account for /pipeline.)
 */
async function orderingFixture(q: Pool, sponsor: string): Promise<string[]> {
  const ids = Array.from({ length: 7 }, () => crypto.randomUUID()).sort().reverse();
  for (const [i, id] of ids.entries()) {
    const co = crypto.randomUUID();
    await q.query(`insert into companies (id, legal_name, normalized_name) values ($1, $2, $3)`, [co, `DG51 Tie Co ${i}`, `dg51 tie co ${i}`]);
    await q.query(
      `insert into opportunities (id, org_id, company_id, name, stage, amount_usd, created_at, updated_at)
       values ($1, $2, $3, $4, 'proposal', 100000, $5, $5)`, [id, sponsor, co, `DG51 tie deal ${i}`, "2026-01-01T00:00:00Z"]);
  }
  // D-G8-1: five equally-attributed stakeholders on the sponsor's largest open deal (a /pipeline lead card),
  // inserted so insertion, contact-id and label order all disagree; two share a label and one has only an email.
  // Returns the labels in the documented order — (coalesce(name, email), contact_id) — computed by Postgres.
  const opp = (await q.query<{ id: string }>(
    `select id from opportunities where org_id = $1 and stage not in ('closed_won', 'closed_lost') order by amount_usd desc nulls last, id limit 1`, [sponsor])).rows[0]?.id;
  if (!opp) return [];
  const cids = Array.from({ length: 5 }, () => crypto.randomUUID()).sort().reverse();
  const names = ["DG81 Tie Delta", "DG81 Tie Alpha", "DG81 Tie Charlie", "DG81 Tie Alpha", null];
  for (const [i, id] of cids.entries()) {
    await q.query(`insert into contacts (id, org_id, email, name, source) values ($1, $2, $3, $4, 'dg81-fixture')`, [id, sponsor, `dg81-tie-${i}@example.invalid`, names[i]]);
    await q.query(`insert into stakeholders (opportunity_id, contact_id, role, sentiment) values ($1, $2, 'influencer', 'unknown')`, [opp, id]);
  }
  return (await q.query<{ label: string }>(
    `select coalesce(ct.name, ct.email) label from stakeholders s join contacts ct on ct.id = s.contact_id
      where s.opportunity_id = $1 and ct.source = 'dg81-fixture' order by coalesce(ct.name, ct.email), s.contact_id`, [opp])).rows.map((r) => r.label);
}

async function main(): Promise<void> {
  if (!existsSync(".next/BUILD_ID")) throw new Error("no production build — run `npm run build` first");
  const src = new URL(SRC).pathname.slice(1);
  const admin = new Pool({ connectionString: ADMIN, max: 1 });
  await admin.query(`create database "${CLONE}" template "${src}"`);
  const owner = urlFor(CLONE), rw = urlFor(CLONE, "app_rw", RW_PASSWORD);
  try {
    const p = new Pool({ connectionString: rw, max: 1 });
    const who = (await p.query<{ u: string; bypass: boolean; n: string }>(
      `select current_user u, (select rolbypassrls from pg_roles where rolname = current_user) bypass, (select count(*)::text from pursuits) n`)).rows[0];
    await p.end();
    console.log(`[app-rw-rehearsal] clone ${CLONE} · app_rw login: current_user=${who.u} rolbypassrls=${who.bypass} · pursuits visible with no app.org_id: ${who.n}`);
    const q = await new Pool({ connectionString: owner, max: 1 });
    const one = async (sql: string) => (await q.query<{ id: string }>(sql)).rows[0]?.id ?? null;
    const sponsor = (await one(`select resolve_user_org(null) id`))!;
    const hero = await one(`select p.id from pursuits p join companies c on c.id = p.account_id where p.org_id = '${sponsor}' and c.legal_name = 'Globex Manufacturing Inc.' order by p.created_at limit 1`);
    const account = await one(`select account_id id from pursuits where id = '${hero}'`);
    const firstOf = (t: string) => one(`select id from ${t} where org_id = '${sponsor}' order by created_at limit 1`);
    const [contact, motion, goal, partner] = [await firstOf("contacts"), await firstOf("revenue_motions"), await firstOf("goals"), await firstOf("partners")];

    // H1B-0 consent fixture (committed on the CLONE, as the owner): the canonical counterpart holds no
    // shared artefacts, so without this the partnership rooms would render no counterpart data under
    // either role and the comparison would prove nothing about consent-scoped reads. Every artefact is
    // TD SYNNEX → sponsor, on the canonical active partnership and its active joint pursuit.
    const fx = await consentFixture(q, sponsor);
    const ofx = await orderingFixture(q, sponsor);
    await q.end();
    const rooms = [
      "/", "/?today=all", `/?drawer=${account}`, "/queue", "/pipeline", "/accounts", `/accounts/${account}`, "/accounts/export",
      "/contacts", `/contacts/${contact}`, "/mapping", "/pursuits", `/pursuits/${hero}`, "/motions", `/briefs/${motion}`, "/goals",
      `/goals/${goal}`, "/campaigns", "/upcoming", "/analytics", "/insights", "/review", "/sources", "/provider-health", "/partners",
      `/partners/${partner}`, `/partners/${partner}/review`, "/joint", "/skills", "/routines", "/admin", "/ops", "/ask", "/trust", "/intake",
      "/api/palette?q=Globex",
      ...(fx ? [`/joint/${fx.jointPursuit}`, `/accounts/${fx.company}`] : []),
    ];

    let app = await start({ DATABASE_URL: owner, DATABASE_URL_OWNER: owner });
    const asOwner = await crawl(rooms);
    const asOwner2 = await crawl(rooms);
    const postureOwner = await posture();
    await stop(app);
    app = await start({ DATABASE_URL: rw, DATABASE_URL_OWNER: owner });
    const asRw = await crawl(rooms);
    const postureRw = await posture();
    await stop(app);
    // Gate 6, rehearsed: the running process must report its own posture truthfully under each role.
    const ownerOk = postureOwner?.probe === "live" && postureOwner.role === "postgres" && postureOwner.bypassRls === true && postureOwner.tenantEnforcement === false;
    const rwOk = postureRw?.probe === "live" && postureRw.role === "app_rw" && postureRw.bypassRls === false && postureRw.tenantEnforcement === true;
    console.log(`/api/build posture — owner: ${JSON.stringify(postureOwner)} ${ownerOk ? "✓" : "✗"}`);
    console.log(`/api/build posture — app_rw: ${JSON.stringify(postureRw)} ${rwOk ? "✓" : "✗"}`);
    if (!ownerOk || !rwOk) process.exitCode = 1;

    let same = 0;
    const rows: string[] = [];
    for (const r of rooms) {
      const a = asOwner.get(r)!, a2 = asOwner2.get(r)!, b = asRw.get(r)!;
      let verdict = "IDENTICAL";
      if (a.status !== b.status) verdict = `STATUS ${a.status} → ${b.status}`;
      else {
        const n = Math.max(a.lines.length, b.lines.length);
        for (let i = 0; i < n; i++) {
          if (a.lines[i] === b.lines[i] || a.lines[i] !== a2.lines[i]) continue;
          verdict = `DIFFERS at line ${i}: "${(a.lines[i] ?? "").slice(0, 70)}" → "${(b.lines[i] ?? "").slice(0, 70)}"`;
          break;
        }
      }
      if (verdict === "IDENTICAL") same++;
      rows.push(`  ${verdict === "IDENTICAL" ? "✓" : "✗"} ${r.padEnd(58)} ${verdict}`);
    }
    console.log(rows.join("\n"));
    // The consent fixture must actually RENDER — under both roles — or the identity above is vacuous.
    let rendered = 0;
    const markerRows: string[] = [];
    if (fx) {
      for (const [room, marker, what] of fx.expect) {
        const inOwner = (asOwner.get(room)?.lines ?? []).some((l) => l.includes(marker));
        const inRw = (asRw.get(room)?.lines ?? []).some((l) => l.includes(marker));
        if (inOwner && inRw) rendered++;
        markerRows.push(`  ${inOwner && inRw ? "✓" : "✗"} ${room.padEnd(58)} counterpart ${what} — owner ${inOwner ? "shown" : "MISSING"} · app_rw ${inRw ? "shown" : "MISSING"}`);
      }
      console.log(`\nConsent-scoped counterpart data (TD SYNNEX → sponsor), rendered under BOTH roles:\n${markerRows.join("\n")}`);
    }
    const fxOk = !fx || rendered === fx.expect.length;
    // D-G8-1: the planted stakeholders must render in the documented order under BOTH roles (every list the page
    // renders them in — each occurrence must be the full expected sequence).
    const planted = (ls: string[]) => ls.filter((l) => /^DG81 Tie |^dg81-tie-\d+@example\.invalid$/.test(l));
    const chunksOk = (ls: string[]) => ofx.length > 0 && ls.length > 0 && ls.length % ofx.length === 0 &&
      Array.from({ length: ls.length / ofx.length }, (_, k) => ls.slice(k * ofx.length, (k + 1) * ofx.length)).every((c) => JSON.stringify(c) === JSON.stringify(ofx));
    const stOwner = planted(asOwner.get("/pipeline")?.lines ?? []), stRw = planted(asRw.get("/pipeline")?.lines ?? []);
    const stOk = chunksOk(stOwner) && chunksOk(stRw) && JSON.stringify(stOwner) === JSON.stringify(stRw);
    console.log(`\nD-G8-1 stakeholder order on /pipeline — expected ${JSON.stringify(ofx)} · owner ${JSON.stringify(stOwner)} · app_rw ${JSON.stringify(stRw)} ${stOk ? "✓" : "✗"}`);
    console.log(`\nAPP_RW REHEARSAL: ${same}/${rooms.length} rooms identical under app_rw (RLS binding) and the owner (RLS bypassed)` +
      (fx ? `; consent fixture rendered ${rendered}/${fx.expect.length} under both.` : "."));
    process.exitCode = same === rooms.length && fxOk && stOk ? 0 : 1;
  } finally {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [CLONE]).catch(() => {});
    await admin.query(`drop database if exists "${CLONE}"`);
    await admin.end();
  }
}

main().catch((e) => { console.error("[app-rw-rehearsal] fatal:", e); process.exit(2); });
