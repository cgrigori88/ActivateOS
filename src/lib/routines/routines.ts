import type { Pool, PoolClient } from "pg";
import { ResendProvider, resendConfigured } from "../comms/resend";
import { commsConfig } from "../comms/provider";

type Db = Pool | PoolClient;

/**
 * Routines v1 (task #73): a CATALOG of scheduled jobs, not free-text
 * automations. Both v1 routines are read-only digests — they summarize and
 * surface, they never send outreach or mutate revenue state. Config is the
 * operator's choice; state is the routine's memory (watermarks), so every
 * run reports what's NEW and never repeats itself.
 *
 *  - morning_brief  (daily): what needs your decision today, compiled
 *    deterministically from the same queries the rooms run — pushed by email
 *    when Resend + a recipient are configured, always stored for the
 *    Routines screen.
 *  - account_digest (weekly): per strategic account (open pipeline or
 *    very-high propensity, capped), everything new since the last run —
 *    verified evidence, engagement moves, upcoming renewals, sends.
 */

export type RoutineKind = "morning_brief" | "account_digest";

export const ROUTINE_CATALOG: {
  kind: RoutineKind;
  label: string;
  cadence: "daily" | "weekly";
  description: string;
  guardrail: string;
}[] = [
  {
    kind: "morning_brief",
    label: "Morning brief",
    cadence: "daily",
    description:
      "What needs your decision today — pending approvals, evidence to review, sends due, incoming partner requests, top opportunities — in one skimmable email before you're at your desk.",
    guardrail: "read-only digest · sends nothing on your behalf",
  },
  {
    kind: "account_digest",
    label: "Account digests",
    cadence: "weekly",
    description:
      "A standing brief per strategic account (open pipeline or very-high propensity): new verified evidence, engagement moves, renewals coming due, campaign activity — only what changed since last week.",
    guardrail: "read-only digest · never repeats what it already told you",
  },
];

export interface RoutineRow {
  id: string;
  org_id: string;
  kind: RoutineKind;
  enabled: boolean;
  config: { hourUtc?: number; weekday?: number; recipient?: string };
  state: { coveredThrough?: string };
  last_run_at: Date | null;
}

export async function listRoutines(db: Db, orgId: string): Promise<RoutineRow[]> {
  // Ensure catalog rows exist so the screen always shows every routine.
  for (const c of ROUTINE_CATALOG) {
    await db.query(
      `insert into routines (org_id, kind) values ($1, $2) on conflict (org_id, kind) do nothing`,
      [orgId, c.kind],
    );
  }
  const { rows } = await db.query<RoutineRow>(
    `select id, org_id, kind, enabled, config, state, last_run_at from routines where org_id = $1 order by kind`,
    [orgId],
  );
  return rows;
}

// ── Morning brief ────────────────────────────────────────────────────────────

interface BriefData {
  pendingMotions: number;
  evidenceToReview: number;
  dueSends: number;
  pendingLists: number;
  incoming: number; // share offers + overlap probes awaiting this org
  topOpps: { name: string; stage: string; amount: number | null }[];
  digestHighlights: { account: string; items: number }[];
  failedRoutines: string[]; // routine kinds whose LATEST run failed
}

async function gatherBrief(db: Db, orgId: string): Promise<BriefData> {
  const one = async (sql: string, params: unknown[] = [orgId]) =>
    Number((await db.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0);

  const pendingMotions = await one(`select count(*) as n from revenue_motions where status = 'proposed'`, []);
  const evidenceToReview = await one(`select count(*) as n from review_queue where status = 'pending' and org_id = $1`);
  const dueSends = await one(
    `select count(*) as n from campaign_touches where status = 'scheduled' and scheduled_at <= now()`,
    [],
  );
  const pendingLists = await one(`select count(*) as n from account_populations where status = 'pending' and org_id = $1`);
  const incoming =
    (await one(
      `select count(*) as n from list_grants g join partnerships p on p.id = g.partnership_id
       where g.status = 'offered' and g.from_org_id <> $1 and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)`,
    )) +
    (await one(
      `select count(*) as n from overlap_probes op join partnerships p on p.id = op.partnership_id
       where op.status = 'requested' and op.requested_by_org <> $1 and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)`,
    ));

  const { rows: topOpps } = await db.query<{ name: string; stage: string; amount: string | null }>(
    `select o.name, o.stage, o.amount_usd as amount from opportunities o
     where o.stage not in ('closed_won','closed_lost') order by o.amount_usd desc nulls last limit 3`,
  );

  const { rows: digestRows } = await db.query<{ account: string; items: string }>(
    `select c.legal_name as account, jsonb_array_length(d.items) as items
     from account_digests d join companies c on c.id = d.company_id
     where d.org_id = $1 and d.created_at > now() - interval '7 days' and jsonb_array_length(d.items) > 0
     order by d.created_at desc limit 5`,
    [orgId],
  );

  // A silently broken routine is worse than no routine — the brief tells on
  // its own siblings (and on itself, on the run after a failure).
  const { rows: failedRows } = await db.query<{ kind: string }>(
    `select x.kind from (
       select distinct on (r.id) r.kind, rr.status
       from routines r join routine_runs rr on rr.routine_id = r.id
       where r.org_id = $1 and r.enabled
       order by r.id, rr.ran_at desc
     ) x where x.status = 'failed'`,
    [orgId],
  );

  return {
    pendingMotions,
    evidenceToReview,
    dueSends,
    pendingLists,
    incoming,
    topOpps: topOpps.map((o) => ({ name: o.name, stage: o.stage, amount: o.amount ? Number(o.amount) : null })),
    digestHighlights: digestRows.map((r) => ({ account: r.account, items: Number(r.items) })),
    failedRoutines: failedRows.map((r) => r.kind.replace(/_/g, " ")),
  };
}

function renderBrief(data: BriefData, appUrl: string): { text: string; subject: string } {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`PursuitOS morning brief — ${today}`, ""];
  if (data.failedRoutines.length > 0) {
    lines.push(`!! ROUTINE FAILURE: ${data.failedRoutines.join(", ")} failed on the last run — check the Routines room.`, "");
  }
  const decisions: string[] = [];
  if (data.pendingMotions > 0) decisions.push(`${data.pendingMotions} motion${data.pendingMotions === 1 ? "" : "s"} awaiting approval`);
  if (data.evidenceToReview > 0) decisions.push(`${data.evidenceToReview} evidence item${data.evidenceToReview === 1 ? "" : "s"} to review`);
  if (data.dueSends > 0) decisions.push(`${data.dueSends} scheduled send${data.dueSends === 1 ? "" : "s"} due now`);
  if (data.pendingLists > 0) decisions.push(`${data.pendingLists} imported list${data.pendingLists === 1 ? "" : "s"} pending review`);
  if (data.incoming > 0) decisions.push(`${data.incoming} partner request${data.incoming === 1 ? "" : "s"} (shares / overlap probes) waiting on you`);

  lines.push("NEEDS YOUR DECISION");
  lines.push(...(decisions.length ? decisions.map((d) => `  • ${d}`) : ["  all clear — nothing is waiting on you"]));
  lines.push("");

  if (data.topOpps.length > 0) {
    lines.push("TOP OPEN OPPORTUNITIES");
    for (const o of data.topOpps) {
      lines.push(`  • ${o.name} — ${o.stage.replace(/_/g, " ")}${o.amount ? ` · $${Math.round(o.amount / 1000)}k` : ""}`);
    }
    lines.push("");
  }
  if (data.digestHighlights.length > 0) {
    lines.push("ACCOUNT DIGESTS THIS WEEK");
    for (const d of data.digestHighlights) lines.push(`  • ${d.account} — ${d.items} new item${d.items === 1 ? "" : "s"}`);
    lines.push("");
  }
  lines.push(`Open the Today room: ${appUrl}`);
  const waiting = decisions.length;
  return {
    subject: waiting > 0 ? `Morning brief — ${waiting} thing${waiting === 1 ? "" : "s"} waiting on you` : "Morning brief — all clear",
    text: lines.join("\n"),
  };
}

export async function runMorningBrief(db: Db, routine: RoutineRow): Promise<{ status: "ok"; summary: Record<string, unknown>; output: string }> {
  const data = await gatherBrief(db, routine.org_id);
  const appUrl = process.env.APP_URL ?? "https://pursuitos.io";
  const { subject, text } = renderBrief(data, appUrl);

  let delivered = false;
  const recipient = routine.config.recipient?.trim();
  if (recipient && resendConfigured()) {
    const cfg = commsConfig();
    await new ResendProvider().send({
      from: { name: "PursuitOS", email: `brief@${cfg.outboundDomain}` },
      to: [recipient],
      subject,
      text,
    });
    delivered = true;
  }

  return {
    status: "ok",
    summary: {
      waiting: data.pendingMotions + data.evidenceToReview + data.dueSends + data.pendingLists + data.incoming,
      delivered,
      recipient: recipient ?? null,
    },
    output: text,
  };
}

// ── Account digests ─────────────────────────────────────────────────────────

const STRATEGIC_CAP = 10;

export interface DigestItem {
  type: "evidence" | "engagement" | "renewal" | "send";
  text: string;
  at: string;
}

export async function runAccountDigests(
  db: Db,
  routine: RoutineRow,
): Promise<{ status: "ok"; summary: Record<string, unknown>; output: string; newState: RoutineRow["state"] }> {
  const orgId = routine.org_id;
  const since = routine.state.coveredThrough ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const now = new Date().toISOString();

  // Strategic accounts: open pipeline first, then very-high propensity.
  const { rows: strategic } = await db.query<{ company_id: string; name: string }>(
    `select distinct c.id as company_id, c.legal_name as name
     from companies c
     where exists (select 1 from opportunities o where o.company_id = c.id and o.stage not in ('closed_won','closed_lost'))
        or exists (select 1 from propensity_scores p where p.company_id = c.id and p.band = 'very_high')
     limit ${STRATEGIC_CAP}`,
  );

  const lines: string[] = [];
  let accountsWithNews = 0;
  for (const acct of strategic) {
    const items: DigestItem[] = [];

    const { rows: ev } = await db.query<{ claim: string; observed_at: Date }>(
      `select claim, observed_at from evidence
       where company_id = $1 and status = 'verified' and collected_at > $2
       order by observed_at desc limit 5`,
      [acct.company_id, since],
    );
    for (const e of ev) items.push({ type: "evidence", text: e.claim.slice(0, 160), at: new Date(e.observed_at).toISOString().slice(0, 10) });

    const { rows: eng } = await db.query<{ engagement_score: string; last_engaged_at: Date | null }>(
      `select es.engagement_score, es.last_engaged_at
       from engagement_scores es
       where es.company_id = $1 and es.last_engaged_at > $2 limit 3`,
      [acct.company_id, since],
    );
    for (const e of eng) {
      items.push({
        type: "engagement",
        text: `Campaign engagement moved (score ${Number(e.engagement_score).toFixed(0)})`,
        at: e.last_engaged_at ? new Date(e.last_engaged_at).toISOString().slice(0, 10) : "",
      });
    }

    const { rows: renewals } = await db.query<{ renewal: string; list: string }>(
      `select pm.attributes->>'renewal_date' as renewal, ap.name as list
       from population_members pm join account_populations ap on ap.id = pm.population_id
       where pm.company_id = $1 and ap.org_id = $2 and ap.status = 'approved'
         and pm.attributes ? 'renewal_date'
         and (pm.attributes->>'renewal_date')::date between now()::date and (now() + interval '90 days')::date
       limit 2`,
      [acct.company_id, orgId],
    );
    for (const r of renewals) items.push({ type: "renewal", text: `Renewal within 90 days (${r.renewal}, from "${r.list}")`, at: r.renewal });

    const { rows: sends } = await db.query<{ subject: string; sent_at: Date }>(
      `select t.subject, t.sent_at from campaign_touches t join campaigns ca on ca.id = t.campaign_id
       where ca.company_id = $1 and t.status = 'sent' and t.sent_at > $2 order by t.sent_at desc limit 3`,
      [acct.company_id, since],
    );
    for (const s of sends) items.push({ type: "send", text: `Sent: "${s.subject}"`, at: new Date(s.sent_at).toISOString().slice(0, 10) });

    await db.query(
      `insert into account_digests (org_id, company_id, period_start, period_end, items)
       values ($1, $2, $3, $4, $5)`,
      [orgId, acct.company_id, since, now, JSON.stringify(items)],
    );
    if (items.length > 0) {
      accountsWithNews++;
      lines.push(`${acct.name}: ${items.length} new — ${items.map((i) => i.type).join(", ")}`);
    }
  }

  return {
    status: "ok",
    summary: { accounts: strategic.length, withNews: accountsWithNews },
    output: lines.length ? lines.join("\n") : "No new activity across strategic accounts this period.",
    newState: { coveredThrough: now },
  };
}

// ── Dispatch + scheduling ───────────────────────────────────────────────────

export async function runRoutine(db: Db, routine: RoutineRow): Promise<void> {
  try {
    let result: { status: "ok"; summary: Record<string, unknown>; output: string; newState?: RoutineRow["state"] };
    if (routine.kind === "morning_brief") result = await runMorningBrief(db, routine);
    else result = await runAccountDigests(db, routine);

    await db.query(
      `update routines set last_run_at = now(), state = coalesce($2::jsonb, state) where id = $1`,
      [routine.id, result.newState ? JSON.stringify(result.newState) : null],
    );
    await db.query(
      `insert into routine_runs (routine_id, status, summary, output) values ($1, 'ok', $2, $3)`,
      [routine.id, JSON.stringify(result.summary), result.output],
    );
  } catch (err) {
    await db.query(`insert into routine_runs (routine_id, status, summary) values ($1, 'failed', $2)`, [
      routine.id,
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    ]);
    throw err;
  }
}

/** Worker entrypoint: run every enabled routine that is due at `now`. */
export async function runDueRoutines(db: Db, now = new Date()): Promise<{ ran: string[] }> {
  const { rows } = await db.query<RoutineRow>(
    `select id, org_id, kind, enabled, config, state, last_run_at from routines where enabled`,
  );
  const ran: string[] = [];
  for (const r of rows) {
    const hour = r.config.hourUtc ?? 7;
    if (now.getUTCHours() !== hour) continue;
    const cadence = ROUTINE_CATALOG.find((c) => c.kind === r.kind)!.cadence;
    if (cadence === "weekly" && now.getUTCDay() !== (r.config.weekday ?? 1)) continue;
    // once per day: skip if already ran today
    if (r.last_run_at && new Date(r.last_run_at).toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) continue;
    await runRoutine(db, r);
    ran.push(`${r.kind}:${r.org_id.slice(0, 8)}`);
  }
  return { ran };
}
