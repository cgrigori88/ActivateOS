import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { directProbes } from "./tenant-isolation-probes";

/**
 * Broad cross-tenant adversarial verifier (H1A Part C).
 *
 * THE CLAIM UNDER TEST. Every surface the application renders for one org is computed from that org's
 * rows only — not merely its lists, but its counts, totals, pipeline, rankings, recommendations, Today,
 * Queue, badges, search, drawers, hidden counts and analytics — and no write accepts another org's id.
 * The application connects as the table owner (BYPASSRLS), so this is proved against the explicit
 * predicates alone: RLS is not in play (that is H1B).
 *
 * HOW. On a disposable CLONE of the canonical world (it commits — verify-run.ts provides the clone):
 *   0  The sponsor is the org the unauthenticated local app renders as (`resolve_user_org(null)`).
 *   1  BASELINE: start the real production build (`next start`) against the clone and crawl every room
 *      twice. Lines that differ between the two crawls (clocks, relative times) are volatile and masked.
 *   2  FOREIGN: create a new tenant and plant, into it, clones of the sponsor's own rows — the same
 *      accounts, the same shapes — each carrying the marker `ZZLEAK` in every human-readable field and
 *      an amount of 987,654,321. Crawl again. Every room must be IDENTICAL to the baseline on every
 *      stable line (a leaked total, count, rank or badge changes a line even when no marker shows), no
 *      response may contain a marker anywhere (HTML, flight data, CSV, JSON), and the foreign tenant's
 *      records must not open by id (detail pages 404 / render nothing of theirs).
 *   3  DIRECT: the non-HTTP surfaces — MCP tools, search resolvers, routines, read models — and every
 *      write path the audit found, called with the foreign tenant's ids as the sponsor: each must refuse
 *      (and the foreign row must not move). See scripts/tenant-isolation-probes.ts.
 *   4  NEGATIVE CONTROL: plant the SAME rows into the sponsor itself (marker `ZZOWN`) and crawl. The
 *      marker must now appear in the rooms that list those records, and those rooms must change —
 *      proving the crawl can see what step 2 says is absent, so its silence means something.
 *
 * CLASSIFICATION: SEEDED, isolation SEEDED_CLONE (it commits planted rows so the running app can see
 * them). Requires a production build (`npm run build`) of the code under test.
 *
 *   npx tsx scripts/verify-run.ts --suite tenant-isolation
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const PORT = Number(process.env.TENANT_VERIFY_PORT ?? 3197);
const BASE = `http://127.0.0.1:${PORT}`;
const pool = new Pool({ connectionString: CONN, max: 3 });

let passed = 0, failed = 0;
const failures: string[] = [];
export function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ── planting ─────────────────────────────────────────────────────────────────────────────────────

const FOREIGN_AMOUNT = 987654321;
const OWN_AMOUNT = 876543210;
const FOREIGN_RX = /ZZLEAK|zzleak|987,?654,?321|\$98[78](?:\.\d+)?\s?M\b/;
const OWN_RX = /ZZOWN|zzown/;

/** Clone one existing row (chosen by `where` over alias `t`) with overrides; returns its id or null. */
async function clone(db: PoolClient, table: string, where: string, params: unknown[], overrides: Record<string, unknown>, opts: { noId?: boolean } = {}): Promise<string | null> {
  const id = randomUUID();
  const n = params.length;
  await db.query("savepoint plant");
  try {
    const r = await db.query<{ id?: string }>(
      `insert into ${table}
         select (jsonb_populate_record(null::${table}, to_jsonb(t) || $${n + 1}::jsonb)).*
           from ${table} t where ${where} limit 1
       ${opts.noId ? "" : "returning id"}`,
      [...params, JSON.stringify(opts.noId ? overrides : { id, ...overrides })]);
    await db.query("release savepoint plant");
    return opts.noId ? (r.rowCount ? "ok" : null) : (r.rows[0]?.id ?? null);
  } catch (e) {
    await db.query("rollback to savepoint plant");
    console.log(`     (could not plant ${table}: ${(e as Error).message.split("\n")[0]})`);
    return null;
  }
}

/** Insert one row from explicit values (columns not named take their defaults); returns its id or null. */
async function insertRow(db: PoolClient, table: string, values: Record<string, unknown>): Promise<string | null> {
  const id = randomUUID();
  const cols = ["id", ...Object.keys(values)];
  await db.query("savepoint plant");
  try {
    const r = await db.query<{ id: string }>(
      `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      [id, ...Object.values(values)]);
    await db.query("release savepoint plant");
    return r.rows[0]?.id ?? null;
  } catch (e) {
    await db.query("rollback to savepoint plant");
    console.log(`     (could not insert ${table}: ${(e as Error).message.split("\n")[0]})`);
    return null;
  }
}

export interface Planted { [k: string]: string | null }

/**
 * Plant a full book of records for `target`, cloned from the sponsor's own rows on the sponsor's own
 * hero account, every readable field carrying `tag`. Used twice: into a FOREIGN tenant (must be
 * invisible to the sponsor) and into the SPONSOR itself (the negative control — must be visible).
 */
async function plantBook(db: PoolClient, sponsor: string, target: string, account: string, tag: string, amount: number): Promise<Planted> {
  const S = [sponsor];
  const lc = tag.toLowerCase();
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 86_400_000).toISOString();
  const later = new Date(Date.now() + 120_000).toISOString();
  const p: Planted = {};
  p.partner = await clone(db, "partners", "t.org_id = $1", S, { org_id: target, name: `${tag} Partner` });
  p.seller = await clone(db, "sellers", "t.org_id = $1", S, { org_id: target, name: `${tag} Seller`, email: `${lc}-seller@leak.invalid`, territory: `${tag} Territory`, partner_id: p.partner });
  p.pursuit = await clone(db, "pursuits", "t.org_id = $1 and t.account_id = $2 and t.status not in ('WON','LOST','DISQUALIFIED')", [sponsor, account], {
    org_id: target, use_case: `${tag} pursuit use case`, business_problem: `${tag} business problem`, compelling_event: `${tag} compelling event`,
    dedup_key: `${lc}-${randomUUID()}`, selected_partner_id: null, recommended_partner_id: p.partner, approved_motion_id: null, recommended_motion_id: null,
    expected_value_high: amount, expected_value_weighted: amount, current_priority_score: 99, last_material_change_at: now, updated_at: now,
  });
  p.snapshot = p.pursuit ? await clone(db, "pursuit_route_snapshots", "t.org_id = $1 and t.is_current and t.route_status = 'RECOMMENDED'", S, { org_id: target, pursuit_id: p.pursuit, recommended_partner_id: p.partner, selected_partner_id: null, calculated_at: now }) : null;
  p.ledger = p.pursuit ? await clone(db, "change_ledger", "t.org_id = $1 and t.change_type = 'ROUTE_RECOMMENDATION_CHANGED' and t.materiality in ('MEDIUM','HIGH','CRITICAL')", S, { org_id: target, pursuit_id: p.pursuit, reason: `${tag} ledger reason`, recorded_at: now, occurred_at: now }) : null;
  p.teamWait = p.pursuit ? await clone(db, "pursuit_team_members", "t.org_id = $1 and t.status = 'INVITED'", S, { org_id: target, pursuit_id: p.pursuit }) : null;
  const motion = (status: string) => clone(db, "revenue_motions", "t.org_id = $1", S, {
    org_id: target, company_id: account, status, thesis: `${tag} motion thesis`, trigger_summary: `${tag} trigger`, operator_notes: `${tag} notes`, cta: `${tag} cta`,
    estimated_value_usd: amount, partner_id: p.partner, pursuit_id: p.pursuit, goal_id: null, initiative_id: null, created_at: now,
  });
  p.motionActive = await motion("active");
  p.motionDraft = await motion("draft");
  p.motionApproved = await motion("approved");
  p.step = p.motionActive ? await clone(db, "motion_actions", "t.org_id = $1 and t.status = 'pending'", S, { org_id: target, motion_id: p.motionActive, step: 1, due_at: now }) : null;
  p.opportunity = await clone(db, "opportunities", "t.org_id = $1 and t.stage not in ('closed_won','closed_lost')", S, {
    org_id: target, company_id: account, name: `${tag} Opportunity`, next_step: `${tag} next step`, amount_usd: amount, pursuit_id: p.pursuit, motion_id: p.motionActive, initiative_id: null, updated_at: now,
  });
  p.opportunityWon = await clone(db, "opportunities", "t.org_id = $1", S, {
    org_id: target, company_id: account, name: `${tag} Won Opportunity`, stage: "closed_won", closed_at: now, amount_usd: amount, pursuit_id: null, motion_id: p.motionActive, initiative_id: null, updated_at: now,
  });
  p.contact = await clone(db, "contacts", "t.org_id = $1", S, { org_id: target, company_id: account, email: `${lc}-contact@leak.invalid`, name: `${tag} Contact`, title: `${tag} Title`, partner_id: null, source: "manual" });
  // The canonical world has no campaign, touch or review row for any org — nothing to clone — so these
  // are inserted from explicit values (valid under the tables' CHECK constraints).
  const campaign = { org_id: target, name: `${tag} Campaign`, objective: `${tag} objective`, recipient_email: `${lc}-recipient@leak.invalid`, motion_id: p.motionActive, company_id: account, created_at: now };
  p.campaign = (await clone(db, "campaigns", "t.org_id = $1", S, { ...campaign, dismissed_at: null, goal_id: null, initiative_id: null, pursuit_id: null }))
    ?? await insertRow(db, "campaigns", { ...campaign, status: "draft", source: "user" });
  const touch = { campaign_id: p.campaign, touch_no: 1, name: `${tag} Touch`, subject: `${tag} touch subject`, headline: `${tag} headline`, body: `${tag} body`, status: "scheduled", scheduled_at: soon };
  p.touch = p.campaign
    ? (await clone(db, "campaign_touches", "exists (select 1 from campaigns c where c.id = t.campaign_id and c.org_id = $1)", S, { ...touch, message_id: null, sent_at: null }))
      ?? await insertRow(db, "campaign_touches", { ...touch, channel: "EMAIL", highlights: [], cc_emails: [], send_offset_days: 0 })
    : null;
  p.evidence = await clone(db, "evidence", "t.org_id = $1 and t.status = 'verified'", S, { org_id: target, company_id: account, claim: `${tag} verified claim`, raw_excerpt: `${tag} excerpt`, claim_fingerprint: `${lc}-${randomUUID()}`, collected_at: now, observed_at: now });
  p.pendingEvidence = await clone(db, "evidence", "t.org_id = $1", S, { org_id: target, company_id: account, claim: `${tag} pending claim`, raw_excerpt: `${tag} pending excerpt`, status: "quarantined", claim_fingerprint: `${lc}-${randomUUID()}` });
  p.review = p.pendingEvidence
    ? (await clone(db, "review_queue", "t.org_id = $1", S, { org_id: target, evidence_id: p.pendingEvidence, status: "pending", notes: `${tag} review notes`, resolved_at: null }))
      ?? await insertRow(db, "review_queue", { org_id: target, evidence_id: p.pendingEvidence, reason: "sample", status: "pending", notes: `${tag} review notes` })
    : null;
  p.score = await clone(db, "propensity_scores", "t.org_id = $1 and t.company_id = $2", [sponsor, account], { org_id: target, score: 99, band: "very_high", computed_at: later, partner_id: p.partner });
  p.engagement = await clone(db, "engagement_scores", "t.org_id = $1 and t.contact_id is null", S, { org_id: target, company_id: account, engagement_score: 99, replies: 42, computed_at: later });
  p.dealReg = await clone(db, "deal_registrations", "t.org_id = $1", S, { org_id: target, opportunity_id: p.opportunity, company_id: account, partner_id: p.partner, vendor: `${tag} Vendor`, product: `${tag} Product`, notes: `${tag} reg notes`, amount_usd: amount, registration_number: `${tag}-REG` });
  p.goal = await clone(db, "goals", "t.org_id = $1", S, { org_id: target, name: `${tag} Goal`, description: `${tag} goal description`, owner: `${tag} Owner` });
  p.population = await clone(db, "account_populations", "t.org_id = $1", S, { org_id: target, partner_id: p.partner, name: `${tag} List` });
  p.member = p.population ? await clone(db, "population_members", "exists (select 1 from account_populations ap where ap.id = t.population_id and ap.org_id = $1)", S, { population_id: p.population }, { noId: true }) : null;
  p.team = p.partner ? await clone(db, "pursuit_teams", "t.org_id = $1", S, { org_id: target, company_id: account, partner_id: p.partner, seller_id: p.seller, pursuit_id: p.pursuit, reason: `${tag} team reason` }) : null;
  p.skill = await clone(db, "skills", "t.org_id = $1", S, { org_id: target, name: `${tag} Skill`, body: `${tag} skill body` });
  p.initiative = await clone(db, "initiatives", "t.org_id = $1", S, { org_id: target, partner_id: p.partner, name: `${tag} Initiative`, description: `${tag} initiative` });
  p.outcome = await clone(db, "outcome_events", "t.org_id = $1", S, { org_id: target, motion_id: p.motionActive, company_id: account, occurred_at: now });
  p.interaction = await clone(db, "interaction_events", "t.org_id = $1", S, { org_id: target, company_id: account, motion_id: p.motionActive, opportunity_id: p.opportunity, contact_id: p.contact, occurred_at: now });
  p.agentRun = await clone(db, "agent_runs", "t.org_id = $1", S, { org_id: target, motion_id: p.motionActive, created_at: now });
  p.providerRun = await clone(db, "provider_runs", "t.org_id = $1 or t.org_id is null", S, { org_id: target, company_id: account, status: "failed", error: `${tag} provider error`, started_at: now });
  p.thread = await clone(db, "communication_threads", "t.org_id = $1", S, { org_id: target, company_id: account, campaign_id: p.campaign, motion_id: p.motionActive, opportunity_id: p.opportunity, thread_alias: `${lc}-${randomUUID()}` });
  p.message = p.thread ? await clone(db, "messages", "exists (select 1 from communication_threads c where c.id = t.thread_id and c.org_id = $1)", S, {
    thread_id: p.thread, subject: `${tag} message subject`, text_body: `${tag} message body`, from_email: `${lc}-from@leak.invalid`, from_name: `${tag} Sender`, provider_message_id: null, internet_message_id: null, created_at: now,
  }) : null;
  p.emailEvent = p.message ? await clone(db, "email_events", "exists (select 1 from communication_threads c where c.id = t.thread_id and c.org_id = $1)", S, { message_id: p.message, thread_id: p.thread, occurred_at: now }) : null;

  // Gaps: record kinds the canonical world holds no row of (for any org) are inserted from explicit
  // values, so the aggregates that read them — Analytics, Insights, Admin, Provider health,
  // engagement — are exercised with foreign rows too.
  const node = (await db.query<{ id: string }>(`select taxonomy_node_id id from propensity_scores where org_id = $1 limit 1`, [sponsor])).rows[0]?.id
    ?? (await db.query<{ id: string }>(`select id from taxonomy_nodes limit 1`)).rows[0]?.id;
  p.engagement ??= await insertRow(db, "engagement_scores", { org_id: target, company_id: account, contact_id: null, touches_sent: 42, opens: 42, clicks: 42, replies: 42, positive_replies: 42, engagement_score: 99, velocity: 9, last_engaged_at: now, computed_at: later });
  p.dealReg ??= await insertRow(db, "deal_registrations", { org_id: target, opportunity_id: p.opportunity, company_id: account, partner_id: p.partner, vendor: `${tag} Vendor`, product: `${tag} Product`, amount_usd: amount, status: "approved", registration_number: `${tag}-REG`, notes: `${tag} reg notes` });
  if (!p.team && p.partner && node) p.team = await insertRow(db, "pursuit_teams", { org_id: target, company_id: account, taxonomy_node_id: node, partner_id: p.partner, seller_id: p.seller, status: "accepted", reason: `${tag} team reason`, pursuit_id: p.pursuit });
  p.initiative ??= await insertRow(db, "initiatives", { org_id: target, partner_id: p.partner, name: `${tag} Initiative`, description: `${tag} initiative`, target_usd: amount, status: "active", created_by: "h1a-probe" });
  p.interaction ??= await insertRow(db, "interaction_events", { org_id: target, company_id: account, motion_id: p.motionActive, opportunity_id: p.opportunity, contact_id: p.contact, actor: `${tag} Actor`, type: "REPLY", channel: "EMAIL", payload: { note: `${tag} interaction` }, occurred_at: now });
  p.agentRun ??= await insertRow(db, "agent_runs", { org_id: target, workflow: "conversation", workflow_version: "h1a", model: `${lc}-model`, motion_id: p.motionActive, input_summary: { note: `${tag} agent run` }, cost_usd: 98.7, created_at: now });
  const provider = (await db.query<{ id: string }>(`select id::text from providers order by 1 limit 1`).catch(() => ({ rows: [] as { id: string }[] }))).rows[0]?.id;
  if (!p.providerRun && provider) p.providerRun = await insertRow(db, "provider_runs", { provider_id: provider, org_id: target, company_id: account, stage: "manual", status: "failed", records_received: 987, error: `${tag} provider error`, started_at: now });
  p.thread ??= await insertRow(db, "communication_threads", { org_id: target, company_id: account, campaign_id: p.campaign, motion_id: p.motionActive, opportunity_id: p.opportunity, thread_alias: `${lc}-${randomUUID()}`, status: "open" });
  if (!p.message && p.thread) p.message = await insertRow(db, "messages", { thread_id: p.thread, direction: "outbound", from_email: `${lc}-from@leak.invalid`, from_name: `${tag} Sender`, to_emails: [`${lc}-to@leak.invalid`], subject: `${tag} message subject`, text_body: `${tag} message body`, status: "sent", sent_at: now });
  if (!p.emailEvent && p.message) p.emailEvent = await insertRow(db, "email_events", { message_id: p.message, thread_id: p.thread, event_type: "OPENED", occurred_at: now });
  return p;
}

// ── crawling ─────────────────────────────────────────────────────────────────────────────────────

interface Page { path: string; status: number; body: string; lines: string[] }

const TIMEISH = /\b\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|w|mo|y)\s+ago\b|\bjust now\b|\b\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago\b|\bin \d+\s*(?:s|m|h|d|minutes?|hours?|days?)\b|\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?|\b20\d\d-\d\d-\d\dT[\d:.]+Z?/g;

function visibleLines(html: string): string[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n").replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  return body.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).map((l) => l.replace(TIMEISH, "⌚"));
}

async function fetchPage(path: string): Promise<Page> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(BASE + path, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      const body = await r.text();
      return { path, status: r.status, body, lines: path.startsWith("/accounts/export") || path.startsWith("/api/") ? body.split("\n") : visibleLines(body) };
    } catch (e) { if (attempt === 2) return { path, status: 0, body: String(e), lines: [] }; }
  }
  throw new Error("unreachable");
}

async function crawl(paths: string[]): Promise<Map<string, Page>> {
  const out = new Map<string, Page>();
  for (const p of paths) out.set(p, await fetchPage(p));
  return out;
}

/** Indices where two baseline crawls disagree — clock-driven lines that carry no tenant signal. */
function volatile(a: Page, b: Page): Set<number> {
  const v = new Set<number>();
  const n = Math.max(a.lines.length, b.lines.length);
  for (let i = 0; i < n; i++) if (a.lines[i] !== b.lines[i]) v.add(i);
  return v;
}

function stableDiff(base: Page, other: Page, vol: Set<number>): string | null {
  if (base.lines.length !== other.lines.length) {
    let i = 0;
    while (i < base.lines.length && base.lines[i] === other.lines[i]) i++;
    return `line count ${base.lines.length} → ${other.lines.length}; first difference at ${i}: "${(base.lines[i] ?? "").slice(0, 90)}" → "${(other.lines[i] ?? "").slice(0, 90)}"`;
  }
  for (let i = 0; i < base.lines.length; i++) {
    if (vol.has(i)) continue;
    if (base.lines[i] !== other.lines[i]) return `line ${i}: "${base.lines[i].slice(0, 90)}" → "${other.lines[i].slice(0, 90)}"`;
  }
  return null;
}

function startApp(): Promise<ChildProcess> {
  if (!existsSync(".next/BUILD_ID")) throw new Error("no production build — run `npm run build` first (the crawl runs the real built app)");
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: "production", PORT: String(PORT), DATABASE_URL: CONN, DATABASE_URL_OWNER: CONN,
    // Local, unauthenticated: the app renders as resolve_user_org(null). No send path, no identity provider.
    BASIC_AUTH_USER: "", BASIC_AUTH_PASS: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    OUTREACH_AUTOSEND: "", RESEND_API_KEY: "",
    // Every room ON, so every room is crawled: the pursuit chain, federation, governed actions and the
    // vNext Slice 2A/2B surfaces (the composed Today). Local process on a disposable clone only — the
    // flag-OFF Today / Queue read path is covered by today-tenant-verify.
    PURSUITS_ENABLED: "true", FACTS_ENABLED: "true", ROUTING_ENABLED: "true", PURSUIT_EXPERIENCE_ENABLED: "true",
    OUTCOME_LEARNING_ENABLED: "true", FEDERATION_ENABLED: "true", GOVERNED_ACTION_ENABLED: "true",
    VNEXT_PURSUIT_COORDINATION_ENABLED: "true", VNEXT_PURSUIT_ATTENTION_ENABLED: "true",
  };
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", (d) => { log += d; });
  child.stderr?.on("data", (d) => { log += d; });
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      try { const r = await fetch(`${BASE}/api/build`, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return resolve(child); } catch { /* not up yet */ }
      if (child.exitCode != null || Date.now() - t0 > 90_000) { child.kill("SIGTERM"); return reject(new Error(`app did not start: ${log.slice(-600)}`)); }
      setTimeout(poll, 700);
    };
    setTimeout(poll, 1200);
  });
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await assertSeededClone(pool);
  console.log(`[tenant-isolation-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const q1 = async <T,>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;
  const sponsor = (await q1<{ id: string }>(`select resolve_user_org(null) id`)).id;
  const sponsorName = (await q1<{ name: string }>(`select name from organizations where id = $1`, [sponsor])).name;
  const hero = await q1<{ id: string; account_id: string } | undefined>(
    `select p.id, p.account_id from pursuits p join companies c on c.id = p.account_id
      where p.org_id = $1 and c.legal_name = 'Globex Manufacturing Inc.' order by p.created_at limit 1`, [sponsor]);
  if (!hero) { console.log("FATAL: canonical world not seeded (no sponsor Globex pursuit)."); process.exit(1); }
  const account = hero.account_id;
  const own = async (table: string, extra = "") => (await q1<{ id: string } | undefined>(`select id from ${table} where org_id = $1 ${extra} order by created_at limit 1`, [sponsor]))?.id ?? null;
  const ids = {
    contact: await own("contacts"), campaign: await own("campaigns"), goal: await own("goals"), motion: await own("revenue_motions"),
    partner: await own("partners"),
  };
  console.log(`Sponsor (the org the local app renders as): ${sponsorName}`);

  const rooms = [
    "/", "/?today=all", `/?drawer=${account}`, "/queue", "/pipeline", "/accounts", `/accounts/${account}`, "/accounts/export",
    "/contacts", ids.contact ? `/contacts/${ids.contact}` : null, "/mapping", "/pursuits", `/pursuits/${hero.id}`, "/motions",
    ids.motion ? `/briefs/${ids.motion}` : null, "/goals", ids.goal ? `/goals/${ids.goal}` : null, "/campaigns",
    ids.campaign ? `/campaigns/${ids.campaign}` : null, "/upcoming", "/analytics", "/insights", "/review", "/sources", "/provider-health",
    "/partners", ids.partner ? `/partners/${ids.partner}` : null, ids.partner ? `/partners/${ids.partner}/review` : null,
    "/joint", "/skills", "/routines", "/admin", "/ops", "/ask", "/trust", "/intake",
    "/api/palette?q=Globex", "/api/palette?q=ZZ",
  ].filter((x): x is string => !!x);

  let app: ChildProcess | null = null;
  try {
    app = await startApp();
    // =============================================================================================
    console.log(`\n1  Baseline — ${rooms.length} rooms crawled twice from the real build`);
    // =============================================================================================
    const b1 = await crawl(rooms);
    const b2 = await crawl(rooms);
    const vol = new Map<string, Set<number>>();
    for (const r of rooms) {
      const a = b1.get(r)!, b = b2.get(r)!;
      vol.set(r, volatile(a, b));
      check(`${r}: renders (HTTP ${a.status})`, a.status >= 200 && a.status < 400, a.status === 0 ? a.body.slice(0, 120) : "");
    }
    const noisy = rooms.filter((r) => (vol.get(r)!.size) > 0).map((r) => `${r} (${vol.get(r)!.size})`);
    console.log(`     volatile lines masked (clock-driven): ${noisy.length ? noisy.join(", ") : "none"}`);
    check("the baseline contains no marker (the world is clean before planting)", rooms.every((r) => !FOREIGN_RX.test(b1.get(r)!.body) && !OWN_RX.test(b1.get(r)!.body)));

    // =============================================================================================
    console.log("\n2  Foreign tenant planted — the sponsor's rooms must not move");
    // =============================================================================================
    const foreignOrg = randomUUID();
    const c = await pool.connect();
    let foreign: Planted;
    try {
      await c.query("begin");
      await c.query(`insert into organizations (id, name, kind) values ($1, $2, 'full')`, [foreignOrg, `ZZLEAK Tenant ${foreignOrg.slice(0, 6)}`]);
      foreign = await plantBook(c, sponsor, foreignOrg, account, "ZZLEAK", FOREIGN_AMOUNT);
      await c.query("commit");
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
    const plantedKeys = Object.entries(foreign).filter(([, v]) => v).map(([k]) => k);
    const missing = Object.entries(foreign).filter(([, v]) => !v).map(([k]) => k);
    console.log(`     planted ${plantedKeys.length} foreign record kinds${missing.length ? ` (not plantable from this world: ${missing.join(", ")})` : ""}`);
    for (const k of ["partner", "pursuit", "opportunity", "opportunityWon", "contact", "campaign", "touch", "evidence", "review", "score", "motionActive", "goal", "population"]) {
      check(`planted a foreign ${k}`, !!foreign[k]);
    }
    const f1 = await crawl(rooms);
    for (const r of rooms) {
      const page = f1.get(r)!;
      const m = page.body.match(FOREIGN_RX);
      check(`${r}: no foreign marker anywhere in the response`, !m, m ? `found "${m[0]}" near …${page.body.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 60).replace(/\s+/g, " ")}` : "");
      const d = stableDiff(b1.get(r)!, page, vol.get(r)!);
      check(`${r}: identical to baseline on every stable line (lists, counts, totals, ranks, badges)`, d === null, d ?? "");
    }
    const byId: [string, string | null][] = [
      ["pursuit", foreign.pursuit ? `/pursuits/${foreign.pursuit}` : null], ["contact", foreign.contact ? `/contacts/${foreign.contact}` : null],
      ["campaign", foreign.campaign ? `/campaigns/${foreign.campaign}` : null], ["goal", foreign.goal ? `/goals/${foreign.goal}` : null],
      ["brief", foreign.motionActive ? `/briefs/${foreign.motionActive}` : null], ["partner", foreign.partner ? `/partners/${foreign.partner}` : null],
      ["partner review", foreign.partner ? `/partners/${foreign.partner}/review` : null],
      ["mapping drill-down", foreign.population ? `/mapping?rows=${foreign.population}&cols=${foreign.population}` : null],
      ["palette", "/api/palette?q=ZZLEAK"],
    ];
    for (const [label, path] of byId) {
      if (!path) continue;
      const page = await fetchPage(path);
      const m = page.body.match(FOREIGN_RX);
      check(`the foreign ${label} does not open by id as the sponsor (HTTP ${page.status}, nothing of theirs rendered)`, !m, m ? `found "${m[0]}"` : "");
    }

    // =============================================================================================
    console.log("\n3  Direct surfaces and writes (MCP, search, routines, read models, every audited write)");
    // =============================================================================================
    await directProbes(pool, { sponsor, foreignOrg, account, hero: hero.id, foreign, check, foreignRx: FOREIGN_RX });

    // =============================================================================================
    console.log("\n4  Negative control — the same rows planted into the sponsor itself MUST show");
    // =============================================================================================
    const c2 = await pool.connect();
    let ownBook: Planted;
    try {
      await c2.query("begin");
      ownBook = await plantBook(c2, sponsor, sponsor, account, "ZZOWN", OWN_AMOUNT);
      await c2.query("commit");
    } catch (e) { await c2.query("rollback").catch(() => {}); throw e; } finally { c2.release(); }
    const o1 = await crawl(rooms);
    const sensitive: string[] = [], insensitive: string[] = [];
    for (const r of rooms) {
      const moved = OWN_RX.test(o1.get(r)!.body) || stableDiff(b1.get(r)!, o1.get(r)!, vol.get(r)!) !== null;
      (moved ? sensitive : insensitive).push(r);
    }
    console.log(`     rooms the control moved (${sensitive.length}): ${sensitive.join(" ")}`);
    console.log(`     rooms the control did not move (${insensitive.length}): ${insensitive.join(" ") || "none"}`);
    // The rooms that list the planted records by name must show the marker — otherwise section 2's
    // silence on them proves nothing.
    const mustShow: [string, string][] = [
      ["/pipeline", "opportunity"], ["/contacts", "contact"], ["/campaigns", "campaign"], ["/upcoming", "scheduled touch"],
      ["/pursuits", "pursuit"], ["/goals", "goal"], ["/review", "pending claim"], ["/partners", "partner"], ["/skills", "skill"],
      ["/motions", "motion"], ["/mapping", "list"], [`/accounts/${account}`, "account-room records"],
      ["/api/palette?q=ZZ", "palette search"],
    ];
    for (const [r, what] of mustShow) check(`control: ${r} shows the sponsor's own planted ${what}`, OWN_RX.test(o1.get(r)?.body ?? ""));
    // The export carries scores and counts, not record names — so it must CHANGE, not show a marker.
    const mustMove = ["/", "/?today=all", "/accounts", "/accounts/export", "/analytics", "/insights", "/queue", "/provider-health", "/sources"];
    for (const r of mustMove) check(`control: ${r} changes when the sponsor's own rows are added (counts / totals / rankings are live)`, sensitive.includes(r));
    void ownBook;
  } finally {
    app?.kill("SIGTERM");
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) for (const f of failures) console.log(`  - ${f}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error("[tenant-isolation-verify] fatal:", e); await pool.end().catch(() => {}); process.exit(1); });
