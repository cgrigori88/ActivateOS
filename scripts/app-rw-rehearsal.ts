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
      VNEXT_PURSUIT_COORDINATION_ENABLED: "true", VNEXT_PURSUIT_ATTENTION_ENABLED: "true", ...env,
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
    await q.end();
    const rooms = [
      "/", "/?today=all", `/?drawer=${account}`, "/queue", "/pipeline", "/accounts", `/accounts/${account}`, "/accounts/export",
      "/contacts", `/contacts/${contact}`, "/mapping", "/pursuits", `/pursuits/${hero}`, "/motions", `/briefs/${motion}`, "/goals",
      `/goals/${goal}`, "/campaigns", "/upcoming", "/analytics", "/insights", "/review", "/sources", "/provider-health", "/partners",
      `/partners/${partner}`, `/partners/${partner}/review`, "/joint", "/skills", "/routines", "/admin", "/ops", "/ask", "/trust", "/intake",
      "/api/palette?q=Globex",
    ];

    let app = await start({ DATABASE_URL: owner, DATABASE_URL_OWNER: owner });
    const asOwner = await crawl(rooms);
    const asOwner2 = await crawl(rooms);
    await stop(app);
    app = await start({ DATABASE_URL: rw, DATABASE_URL_OWNER: owner });
    const asRw = await crawl(rooms);
    await stop(app);

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
    console.log(`\nAPP_RW REHEARSAL: ${same}/${rooms.length} rooms identical under app_rw (RLS binding) and the owner (RLS bypassed).`);
    process.exitCode = same === rooms.length ? 0 : 1;
  } finally {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [CLONE]).catch(() => {});
    await admin.query(`drop database if exists "${CLONE}"`);
    await admin.end();
  }
}

main().catch((e) => { console.error("[app-rw-rehearsal] fatal:", e); process.exit(2); });
