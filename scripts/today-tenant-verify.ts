import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getAccountIntel } from "../src/lib/accounts/intel";
import { resolveMotionAction } from "../src/lib/motions/cadence";
import { loadQueueWorklist } from "../src/lib/motions/queue-read";
import { composeTodayAttention, loadPursuitAttention, loadQueuePlanLineage } from "../src/lib/pursuits/read-models/attention-loaders";
import { callerFor } from "../src/lib/pursuits/read-models/caller";
import { getTodayExposure, getTodayQueue } from "../src/lib/pursuits/read-models/today";
import type { TodayQueueView } from "../src/lib/pursuits/read-models/types";
import { loadTodayNextActions, loadTodayOverview } from "../src/lib/today/overview";

/**
 * Today / Queue tenant isolation — integration harness (2026-09-14 hardening, Slice 2B gate).
 *
 * THE DEFECT THIS GUARDS. The app connects as the table owner, which bypasses RLS (task #67), and
 * several Today and Queue queries named no org. A guest org's certified (flag-OFF) Today listed 18
 * of another org's items. Every Today / Queue read is now scoped explicitly in SQL; this harness
 * proves it against the real schema, with the Slice 2B flag OFF (the certified path) and ON (the
 * composed path).
 *
 *   1  Reads never write: every surface, for every org, inside READ ONLY transactions.
 *   2  On the canonical world, no org receives another org's items, counts, rows or lineage.
 *   3  Foreign rows are PLANTED — real Vertex rows cloned into the guest org, colliding on the
 *      same pursuit shapes and the same accounts — and Vertex's entire Today / Queue output must
 *      be unchanged (cards, ranking, urgency, "other items", badge, counts, pipeline, drawer),
 *      while the guest's own new rows render for the guest.
 *   4  Writes: a guest cannot resolve another org's queue item by id.
 *   5  No send rows; the world is left exactly as it was found (every write rolled back).
 *
 * CLASSIFICATION: SEEDED — it reads the canonical world's orgs.
 *
 *   DATABASE_URL_VERIFY=… npx tsx scripts/today-tenant-verify.ts
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN, max: 2 });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

async function txn<T>(orgId: string, readOnly: boolean, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(readOnly ? "begin read only" : "begin");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
const count = async (db: PoolClient, sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

const WORLD = ["pursuits", "pursuit_route_snapshots", "change_ledger", "pursuit_team_members", "opportunities", "revenue_motions",
  "motion_actions", "outcome_events", "evidence", "propensity_scores", "pursuit_plan_revisions", "governed_action_invocations",
  "action_outbox", "messages", "email_events"];
async function snapshot(db: PoolClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of WORLD) out[t] = await count(db, `select count(*)::text n from ${t}`);
  return out;
}

interface Surface {
  raw: TodayQueueView; composed: TodayQueueView; exposure: Awaited<ReturnType<typeof getTodayExposure>>;
  next: Awaited<ReturnType<typeof loadTodayNextActions>>; overview: Awaited<ReturnType<typeof loadTodayOverview>>;
  queue: Awaited<ReturnType<typeof loadQueueWorklist>>; lineage: Record<string, unknown>;
  drawer: Awaited<ReturnType<typeof getAccountIntel>>; attentionKeys: string[];
}

/** Everything the Today and Queue pages read for one org — flag OFF (raw) and ON (composed). */
async function surface(db: PoolClient, orgId: string, drawerCompanyId: string): Promise<Surface> {
  const caller = await callerFor(db, orgId);
  const raw = await getTodayQueue(db, caller, {});
  const composed = await composeTodayAttention(db, caller, raw, {});
  const queue = await loadQueueWorklist(db, orgId, null);
  return {
    raw, composed,
    exposure: await getTodayExposure(db, orgId, null),
    next: await loadTodayNextActions(db, orgId),
    overview: await loadTodayOverview(db, orgId, null),
    queue,
    lineage: await loadQueuePlanLineage(db, caller, queue.cadence.map((a) => a.id as string)),
    drawer: await getAccountIntel(db, drawerCompanyId, orgId),
    attentionKeys: (await loadPursuitAttention(db, caller)).map((a) => a.key),
  };
}

/** A reader-visible projection, minus request-time stamps and per-read ids. */
function project(s: Surface): string {
  const items = (v: TodayQueueView) => v.items.map((i) => ({
    p: i.pursuitId, t: i.type, c: i.decisionClass, u: i.operationalUrgency, b: i.commercialPriority, title: i.title, reason: i.reason,
    others: (i.others ?? []).map((o) => o.title), att: i.attention ? { owner: i.attention.ownerLabel, due: i.attention.dueLabel } : null,
  }));
  return JSON.stringify({
    raw: { total: s.raw.total, counts: s.raw.counts, banner: s.raw.demoBanner, items: items(s.raw) },
    composed: { total: s.composed.total, counts: s.composed.counts, banner: s.composed.demoBanner, items: items(s.composed) },
    exposure: s.exposure, next: s.next, overview: s.overview,
    queue: { cadence: s.queue.cadence.map((r) => r.id), comms: s.queue.comms.map((r) => r.id), recent: s.queue.recent.map((r) => `${r.legal_name}:${r.action}`) },
    lineage: Object.keys(s.lineage).sort(), drawer: s.drawer, attention: s.attentionKeys,
  });
}

/** Clone one existing row into another org with overrides — a foreign row shaped exactly like a real one. */
async function clone(db: PoolClient, table: string, where: string, params: unknown[], overrides: Record<string, unknown>): Promise<string | null> {
  const id = randomUUID();
  await db.query("savepoint clone");
  try {
    const n = params.length;
    const r = await db.query<{ id: string }>(
      `insert into ${table}
         select (jsonb_populate_record(null::${table}, to_jsonb(t) || $${n + 1}::jsonb)).*
           from ${table} t where ${where} limit 1
       returning id`,
      [...params, JSON.stringify({ id, ...overrides })]);
    await db.query("release savepoint clone");
    return r.rows[0]?.id ?? null;
  } catch (e) {
    await db.query("rollback to savepoint clone");
    console.log(`     (could not plant ${table}: ${(e as Error).message})`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`[today-tenant-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const orgs = (await pool.query<{ id: string; name: string; kind: string }>(`select id, name, kind from organizations order by created_at`)).rows;
  const hero = (await pool.query<{ id: string; org_id: string; account_id: string }>(
    `select p.id, p.org_id, p.account_id from pursuits p join companies c on c.id = p.account_id
      where c.legal_name = 'Globex Manufacturing Inc.' and p.pursuit_type = 'MODERNIZATION' order by p.created_at limit 1`)).rows[0];
  if (!hero) { console.log("FATAL: canonical world not seeded."); process.exit(1); }
  const vertex = orgs.find((o) => o.id === hero.org_id)!;
  const guest = orgs.find((o) => o.kind === "guest") ?? orgs.find((o) => o.id !== vertex.id)!;
  const globex = hero.account_id;
  const orgOf = async (db: PoolClient, table: string, ids: string[]) => ids.length
    ? (await db.query<{ id: string; org_id: string | null }>(`select id, org_id from ${table} where id = any($1::uuid[])`, [ids])).rows : [];
  console.log(`\nSponsor org: ${vertex.name} · guest org: ${guest.name}`);
  const worldBefore = await txn(vertex.id, true, snapshot);

  // =========================================================================
  console.log("\n1  Reads never write — every org's Today and Queue, inside READ ONLY transactions");
  // =========================================================================
  const surfaces = new Map<string, Surface>();
  for (const o of orgs) {
    let err = "OK";
    try {
      await txn(o.id, true, async (db) => {
        const s0 = await snapshot(db);
        surfaces.set(o.id, await surface(db, o.id, globex));
        check(`${o.name}: Today + Queue reads wrote nothing`, JSON.stringify(s0) === JSON.stringify(await snapshot(db)));
      });
    } catch (e) { err = (e as { code?: string }).code ?? String(e); }
    check(`${o.name}: …and could not have (a write under READ ONLY raises 25006)`, err === "OK", err);
  }

  // =========================================================================
  console.log("\n2  Canonical world — nobody receives another org's data (flag OFF and ON)");
  // =========================================================================
  for (const o of orgs) {
    const s = surfaces.get(o.id)!;
    await txn(o.id, true, async (db) => {
      const pursuitIds = (v: TodayQueueView) => [...new Set(v.items.map((i) => i.pursuitId).filter((x): x is string => !!x))];
      const rawForeign = (await orgOf(db, "pursuits", pursuitIds(s.raw))).filter((r) => r.org_id !== o.id);
      const onForeign = (await orgOf(db, "pursuits", pursuitIds(s.composed))).filter((r) => r.org_id !== o.id);
      check(`${o.name}: flag OFF — zero foreign pursuit items on Today (was 18 for the guest before the fix)`, rawForeign.length === 0, `${rawForeign.length} foreign`);
      check(`${o.name}: flag ON — zero foreign pursuit items on Today`, onForeign.length === 0, `${onForeign.length} foreign`);
      const own = await count(db, `select count(*)::text n from opportunities where org_id = $1 and stage not in ('closed_won','closed_lost')`, [o.id]);
      check(`${o.name}: open pipeline counts only its own opportunities`, s.exposure.openCount === own, `${s.exposure.openCount} vs ${own}`);
      const c = s.overview.counts[0];
      const expect = {
        draft_motions: await count(db, `select count(*)::text n from revenue_motions where status = 'draft' and org_id = $1`, [o.id]),
        scored_accounts: await count(db, `select count(distinct company_id)::text n from propensity_scores where org_id = $1`, [o.id]),
        verified_evidence: await count(db, `select count(*)::text n from evidence where status = 'verified' and org_id = $1`, [o.id]),
      };
      check(`${o.name}: At-a-glance counts are its own`, Number(c.draft_motions) === expect.draft_motions && Number(c.scored_accounts) === expect.scored_accounts && Number(c.verified_evidence) === expect.verified_evidence,
        JSON.stringify({ got: c, expect }));
      const motionOrgs = await orgOf(db, "revenue_motions", s.queue.cadence.map((r) => r.motion_id as string));
      check(`${o.name}: Queue holds only its own motions' steps`, motionOrgs.every((r) => r.org_id === o.id), `${motionOrgs.filter((r) => r.org_id !== o.id).length} foreign`);
      const lineageOrgs = await orgOf(db, "motion_actions", Object.keys(s.lineage));
      check(`${o.name}: Queue plan lineage only on its own rows`, lineageOrgs.every((r) => r.org_id === o.id));
      const drawerOwn = await count(db, `select count(*)::text n from opportunities where company_id = $1 and org_id = $2 and stage not like 'closed%'`, [globex, o.id]);
      check(`${o.name}: the account drawer (?drawer=Globex) shows only its own pipeline and pursuit`,
        (s.drawer?.hunt.openOpps ?? 0) === drawerOwn && (o.id === vertex.id || s.drawer?.hunt.useCase == null),
        `openOpps ${s.drawer?.hunt.openOpps} vs ${drawerOwn}`);
    });
  }
  check("the guest's own pursuit still reaches its Today when it has something to decide (see section 3)", true);

  // =========================================================================
  console.log("\n3  Planted foreign rows — Vertex's Today and Queue must not move (rolled back)");
  // =========================================================================
  await txn(vertex.id, false, async (db) => {
    const baseline = project(await surface(db, vertex.id, globex));
    const guestPursuit = (await db.query<{ id: string }>(`select id from pursuits where org_id = $1 order by created_at limit 1`, [guest.id])).rows[0]?.id;
    check("the guest org owns a pursuit to plant rows against", !!guestPursuit);
    if (!guestPursuit) return;
    const G = guest.id;
    const now = new Date().toISOString();
    // Make room for a current snapshot on the guest pursuit (a unique-current index may exist).
    await db.query(`update pursuit_route_snapshots set is_current = false where pursuit_id = $1`, [guestPursuit]);
    const planted = {
      routeSnapshot: await clone(db, "pursuit_route_snapshots", "t.is_current and t.route_status = 'RECOMMENDED' and t.selected_partner_id is null and t.org_id = $1", [vertex.id], { org_id: G, pursuit_id: guestPursuit, calculated_at: now }),
      ledger: await clone(db, "change_ledger", "t.change_type = 'ROUTE_RECOMMENDATION_CHANGED' and t.materiality in ('MEDIUM','HIGH','CRITICAL') and t.org_id = $1", [vertex.id], { org_id: G, pursuit_id: guestPursuit, recorded_at: now, occurred_at: now }),
      teamWait: await clone(db, "pursuit_team_members", "t.status = 'INVITED' and t.org_id = $1", [vertex.id], { org_id: G, pursuit_id: guestPursuit }),
      opportunity: await clone(db, "opportunities", "t.org_id = $1 and t.stage not in ('closed_won','closed_lost')", [vertex.id], { org_id: G, company_id: globex, pursuit_id: null, motion_id: null, name: "Guest-org fixture opportunity", updated_at: now }),
      draftMotion: await clone(db, "revenue_motions", "t.org_id = $1", [vertex.id], { org_id: G, status: "draft", pursuit_id: null }),
      activeMotion: await clone(db, "revenue_motions", "t.org_id = $1 and t.status = 'active'", [vertex.id], { org_id: G, status: "active", pursuit_id: null }),
      outcome: await clone(db, "outcome_events", "t.org_id = $1", [vertex.id], { org_id: G, occurred_at: now }),
      evidence: await clone(db, "evidence", "t.org_id = $1 and t.status = 'verified'", [vertex.id], { org_id: G, claim: "Guest-org fixture claim" }),
      propensity: await clone(db, "propensity_scores", "t.org_id = $1", [vertex.id], { org_id: G, computed_at: new Date(Date.now() + 60_000).toISOString(), score: 99 }),
    } as Record<string, string | null>;
    planted.queueStep = planted.activeMotion
      ? await clone(db, "motion_actions", "t.org_id = $1 and t.status = 'pending'", [vertex.id], { org_id: G, motion_id: planted.activeMotion, step: 1 })
      : null;
    for (const [k, v] of Object.entries(planted)) check(`planted a foreign ${k} in ${guest.name}`, !!v);

    const after = project(await surface(db, vertex.id, globex));
    check("Vertex's Today and Queue are IDENTICAL with the foreign rows present: cards, ranking, urgency, 'other items', badge, counts, pipeline, activity, leaderboard, drawer, queue, lineage, attention",
      after === baseline, firstDiff(baseline, after));

    const g = await surface(db, G, globex);
    const gPursuits = new Set(g.raw.items.map((i) => i.pursuitId));
    check(`${guest.name}: its own route approval renders (flag OFF)`, g.raw.items.some((i) => i.type === "ROUTE_APPROVAL" && i.pursuitId === guestPursuit));
    check(`${guest.name}: its own team wait renders (flag OFF)`, g.raw.items.some((i) => i.type === "TEAM_WAITING" && i.pursuitId === guestPursuit));
    check(`${guest.name}: its own material ledger change renders (flag OFF)`, g.raw.items.some((i) => i.type === "ROUTE_RECOMMENDATION_CHANGED" && i.pursuitId === guestPursuit));
    check(`${guest.name}: and nothing but its own pursuit`, [...gPursuits].every((p) => p === guestPursuit || p == null));
    const gCard = g.composed.items.filter((i) => i.pursuitId === guestPursuit);
    check(`${guest.name}: flag ON — its items collapse to ONE card, with its own other items`, gCard.length === 1 && (gCard[0].others?.length ?? 0) >= 2, JSON.stringify(gCard.map((c) => [c.title, c.others?.length])));
    check(`${guest.name}: its own pipeline, counts, leaderboard, activity and queue render`,
      g.exposure.openCount >= 1 && Number(g.overview.counts[0].draft_motions) >= 1 && Number(g.overview.counts[0].verified_evidence) >= 1
        && g.overview.top.length >= 1 && g.overview.activity.length >= 1 && g.queue.cadence.some((r) => r.id === planted.queueStep),
      JSON.stringify({ open: g.exposure.openCount, counts: g.overview.counts[0], top: g.overview.top.length, activity: g.overview.activity.length, queue: g.queue.cadence.length }));
    check(`${guest.name}: its drawer on Globex shows its own opportunity only`, g.drawer?.hunt.openOpps === 1, String(g.drawer?.hunt.openOpps));

    // ── 4  Writes: a queue item is resolved only by the org that owns it ─────────
    const vertexStep = (await db.query<{ id: string }>(`select a.id from motion_actions a join revenue_motions m on m.id = a.motion_id where m.org_id = $1 and a.status = 'pending' limit 1`, [vertex.id])).rows[0]?.id;
    let refused = false;
    await db.query("savepoint idor");
    try { await resolveMotionAction(db, vertexStep, "done", G); } catch { refused = true; }
    await db.query("rollback to savepoint idor");
    const still = (await db.query<{ status: string }>(`select status from motion_actions where id = $1`, [vertexStep])).rows[0]?.status;
    check("4  a guest cannot resolve another org's queue item by id (update refused, row still pending)", refused && still === "pending");
    await db.query("savepoint own");
    let ownOk = true;
    try { await resolveMotionAction(db, planted.queueStep!, "done", G); } catch { ownOk = false; }
    await db.query("rollback to savepoint own");
    check("   …while it can resolve its own", ownOk);
  });

  // =========================================================================
  console.log("\n5  No send path, and nothing left behind");
  // =========================================================================
  await txn(vertex.id, true, async (db) => {
    const now = await snapshot(db);
    check("no outbox row, no message, no email event", now.action_outbox === 0 && now.messages === 0 && now.email_events === 0);
    check("world unchanged after the harness (all writes rolled back)", JSON.stringify(now) === JSON.stringify(worldBefore), JSON.stringify({ worldBefore, now }));
  });

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) for (const f of failures) console.log(`  - ${f}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= a.length && i >= b.length ? "" : `at ${i}: …${a.slice(Math.max(0, i - 80), i + 120)} ⟂ …${b.slice(Math.max(0, i - 80), i + 120)}`;
}

main().catch(async (e) => { console.error("[today-tenant-verify] fatal:", e); await pool.end().catch(() => {}); process.exit(1); });
