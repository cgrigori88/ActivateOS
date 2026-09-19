import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { MCP_TOOLS } from "../src/lib/agents/mcp-tools";
import { draftTouchImpl } from "../src/lib/agents/mcp-writes";
import { coverageWinRates, suggestMultiVendorPlays } from "../src/lib/campaigns/multi-vendor";
import { linkPopulation, unlinkPopulation } from "../src/lib/campaigns/lists";
import { deleteTouch, upsertTouch } from "../src/lib/comms/authoring";
import { launchCampaign, sendTouchNow } from "../src/lib/comms/sequence";
import { deriveEngagement, emitEngagementSignals } from "../src/lib/intel/engagement";
import { filterReadableRecordHrefs } from "../src/lib/interpret/readable-records";
import { intersection, targetFromCell } from "../src/lib/mapping/populations";
import { partnerHub } from "../src/lib/mapping/partner-hub";
import { advanceOpportunity, createOpportunityFromMotion } from "../src/lib/opportunities/lifecycle";
import { sourceOutcomeAttribution } from "../src/lib/opportunities/autopsy";
import { upsertElement } from "../src/lib/opportunities/meddpicc";
import { brokerPropose } from "../src/lib/partnerships/joint";
import { offerEvidenceShare } from "../src/lib/partnerships/evidence-shares";
import { runAccountDigests, runMorningBrief, type RoutineRow } from "../src/lib/routines/routines";
import { parseShowMe, resolveExplain, resolveShowMeWithTotals } from "../src/lib/search/query";
import { lanePursuitProbes } from "./tenant-isolation-probes-pursuits";

/**
 * The non-HTTP half of the broad tenant verifier (H1A Part C, section 3): every surface a crawl
 * cannot reach (MCP tools, search resolvers, routines, library read models) and every write path the
 * H1A audit found, called AS THE SPONSOR with the FOREIGN tenant's ids.
 *
 *   read  → the result, serialised, must carry no foreign marker (and no foreign total)
 *   write → the foreign row must be exactly as it was afterwards (refused, or a no-op) — each attempt
 *           runs in its own transaction that is ROLLED BACK, whatever happens
 *
 * No send path can fire: the send provider is unset for this process, and a refused send throws
 * before any provider is reached.
 */

process.env.RESEND_API_KEY = "";
process.env.OUTREACH_AUTOSEND = "";

export interface ProbeCtx {
  sponsor: string;
  foreignOrg: string;
  account: string;
  hero: string;
  foreign: Record<string, string | null>;
  check: (name: string, cond: boolean, detail?: string) => void;
  foreignRx: RegExp;
}

export async function inTx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

/** Serialise a read result and report whether any foreign marker is in it. */
export function leaks(v: unknown, rx: RegExp): string | null {
  const s = JSON.stringify(v ?? null);
  const m = s.match(rx);
  return m ? `…${s.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 40)}…` : null;
}

/**
 * Attempt a write as the sponsor against a foreign id; pass iff the foreign row is unchanged
 * afterwards (`fingerprint` re-read inside the same transaction, before the rollback).
 */
export async function refuses(pool: Pool, ctx: ProbeCtx, label: string, fingerprint: (db: PoolClient) => Promise<unknown>, attempt: (db: PoolClient) => Promise<unknown>): Promise<void> {
  await inTx(pool, ctx.sponsor, async (db) => {
    const before = JSON.stringify(await fingerprint(db));
    let outcome = "no-op";
    await db.query("savepoint attempt");
    try { await attempt(db); await db.query("release savepoint attempt"); }
    catch (e) { outcome = `refused: ${(e as Error).message.split("\n")[0].slice(0, 70)}`; await db.query("rollback to savepoint attempt"); }
    const after = JSON.stringify(await fingerprint(db));
    ctx.check(`write — ${label} (${outcome})`, before === after, before === after ? "" : `foreign row changed: ${before.slice(0, 120)} → ${after.slice(0, 120)}`);
  });
}

const row = (table: string, id: string | null) => async (db: PoolClient) =>
  id ? (await db.query(`select to_jsonb(t) - 'updated_at' j from ${table} t where id = $1`, [id])).rows[0]?.j ?? null : null;

export async function directProbes(pool: Pool, ctx: ProbeCtx): Promise<void> {
  const { sponsor, foreign: F, foreignRx: rx, check } = ctx;
  const read = async (label: string, fn: (db: PoolClient) => Promise<unknown>) => {
    let v: unknown; let err: string | null = null;
    try { v = await inTx(pool, sponsor, fn); } catch (e) { err = (e as Error).message.split("\n")[0]; }
    const l = err ? null : leaks(v, rx);
    check(`read — ${label}: no foreign data`, !err && !l, err ? `threw: ${err}` : (l ?? ""));
    return v;
  };

  // ── MCP tools (an API key resolves to the sponsor) ────────────────────────────────────────────
  const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;
  // SLICE 14: renamed; the canonical `pipeline_summary` is now the governed P7 tool, which takes no
  // database handle and therefore cannot be probed through this pool-based harness.
  await read("MCP opportunity_pipeline_summary", (db) => tool("opportunity_pipeline_summary").run(db, sponsor, {}));
  await read("MCP account_brief (Globex)", (db) => tool("account_brief").run(db, sponsor, { account: "Globex" }));
  await read("MCP deal_context (Globex)", (db) => tool("deal_context").run(db, sponsor, { account: "Globex" }));
  await read("MCP initiative_status", (db) => tool("initiative_status").run(db, sponsor, {}));
  await read("MCP overlap_status", (db) => tool("overlap_status").run(db, sponsor, {}));
  await read("MCP joint_pursuits", (db) => tool("joint_pursuits").run(db, sponsor, {}));
  // Asked by the foreign partner's exact name: the tool may echo the QUERY back ("No partner matching
  // …"), which is the caller's own input, not foreign data — so the echo is removed before the check.
  await read("MCP partner_context (the foreign partner's name)", async (db) => {
    const r = await tool("partner_context").run(db, sponsor, { partner: "ZZLEAK Partner" }) as { found?: boolean };
    return r?.found ? r : JSON.parse(JSON.stringify(r ?? null).replaceAll("ZZLEAK Partner", "<query>"));
  });

  // ── Search / Ask ───────────────────────────────────────────────────────────────────────────────
  const showMe = parseShowMe("deals over $1");
  if (showMe) {
    const r = await read("palette SHOW ME deals (hits + dollar total)", (db) => resolveShowMeWithTotals(db, sponsor, showMe.query, null)) as { amountUsd?: number } | undefined;
    check("read — palette SHOW ME total excludes the foreign $987,654,321", (r?.amountUsd ?? 0) < 987654321, String(r?.amountUsd));
  }
  await read("Ask EXPLAIN (why is Globex routed…)", (db) => resolveExplain(db, "why is Globex routed through CDW?", sponsor));
  await read("Ask link filter (a foreign pursuit link is withheld)", async (db) => {
    const kept = await filterReadableRecordHrefs(db, sponsor, [`/pursuits/${F.pursuit}`]);
    return kept.length ? ["ZZLEAK link kept", ...kept] : [];
  });

  // ── Routines (the brief is emailed; the digest is stored) ──────────────────────────────────────
  const routine = (kind: RoutineRow["kind"]): RoutineRow => ({ id: "00000000-0000-0000-0000-000000000000", org_id: sponsor, kind, enabled: true, config: {}, state: {}, last_run_at: null, created_at: new Date().toISOString() } as unknown as RoutineRow);
  await read("routine morning brief (no send provider)", (db) => runMorningBrief(db, routine("morning_brief")));
  await read("routine account digests (and the digests it stores)", async (db) => {
    const r = await runAccountDigests(db, routine("account_digest"));
    const stored = (await db.query(`select * from account_digests where org_id = $1 order by created_at desc limit 50`, [sponsor])).rows;
    return { r, stored };
  });

  // ── Library read models behind rooms (belt to the crawl's braces) ─────────────────────────────
  await read("partner hub (no partner selected)", (db) => partnerHub(db, { orgId: sponsor, partnerId: null }));
  await read("multi-vendor plays", (db) => suggestMultiVendorPlays(db, sponsor));
  await read("coverage win rates", (db) => coverageWinRates(db, sponsor));
  await read("source → outcome attribution", (db) => sourceOutcomeAttribution(db, sponsor));
  if (F.population) {
    let refusedRead = false;
    try { await inTx(pool, sponsor, (db) => intersection(db, { orgId: sponsor, rowPopId: F.population!, colPopId: F.population! })); } catch { refusedRead = true; }
    check("read — mapping drill-down refuses a foreign list id", refusedRead);
  }

  // ── Writes with foreign ids ──────────────────────────────────────────────────────────────────
  if (F.opportunity) {
    await refuses(pool, ctx, "advance a foreign opportunity", row("opportunities", F.opportunity), (db) => advanceOpportunity(db, sponsor, F.opportunity!, "closed_lost", "probe"));
    await refuses(pool, ctx, "set MEDDPICC on a foreign opportunity",
      async (db) => (await db.query(`select count(*)::int n from opportunity_meddpicc where opportunity_id = $1`, [F.opportunity])).rows[0],
      (db) => upsertElement(db, sponsor, { opportunityId: F.opportunity!, element: "metrics" as never, status: "confirmed" as never, notes: "probe" }));
  }
  if (F.motionActive) {
    await refuses(pool, ctx, "promote a foreign motion to an opportunity",
      async (db) => (await db.query(`select count(*)::int n from opportunities where motion_id = $1`, [F.motionActive])).rows[0],
      (db) => createOpportunityFromMotion(db, sponsor, F.motionActive!));
  }
  if (F.population) {
    await refuses(pool, ctx, "create a target list from a foreign cell",
      async (db) => (await db.query(`select count(*)::int n from population_members where population_id = $1`, [F.population])).rows[0],
      (db) => targetFromCell(db, { orgId: sponsor, rowPopId: F.population!, colPopId: F.population!, name: "probe" }));
  }
  if (F.campaign && F.touch) {
    const touch = row("campaign_touches", F.touch);
    const touches = async (db: PoolClient) => (await db.query(`select id, status, subject from campaign_touches where campaign_id = $1 order by id`, [F.campaign])).rows;
    await refuses(pool, ctx, "MCP draft_touch into a foreign campaign (by its name)", touches, (db) => draftTouchImpl(db, sponsor, { campaign: "ZZLEAK Campaign", subject: "probe", body: "probe" }));
    await refuses(pool, ctx, "add a touch to a foreign campaign", touches, (db) => upsertTouch(db, { orgId: sponsor, campaignId: F.campaign!, fields: { subject: "probe", body: "probe" } as never }));
    await refuses(pool, ctx, "edit a foreign touch", touch, (db) => upsertTouch(db, { orgId: sponsor, campaignId: F.campaign!, touchId: F.touch!, fields: { subject: "probe", body: "probe" } as never }));
    await refuses(pool, ctx, "delete a foreign touch", touch, (db) => deleteTouch(db, sponsor, F.touch!));
    await refuses(pool, ctx, "approve a foreign touch", touch, (db) => db.query(
      `update campaign_touches t set status = 'approved' from campaigns c where t.id = $1 and c.id = t.campaign_id and c.org_id = $2`, [F.touch, sponsor]));
    await refuses(pool, ctx, "send a foreign touch now (no provider; must be refused before any send)", touch, (db) => sendTouchNow(db, { orgId: sponsor, touchId: F.touch!, overrideTo: "probe@leak.invalid" }));
    await refuses(pool, ctx, "launch a foreign campaign to an attacker recipient", row("campaigns", F.campaign), (db) => launchCampaign(db, { orgId: sponsor, campaignId: F.campaign!, recipientEmail: "probe@leak.invalid" }));
    if (F.population) {
      const links = async (db: PoolClient) => (await db.query(`select count(*)::int n from campaign_populations where campaign_id = $1 or population_id = $2`, [F.campaign, F.population])).rows[0];
      await refuses(pool, ctx, "link a foreign list to a foreign campaign", links, (db) => linkPopulation(db, sponsor, F.campaign!, F.population!, "probe"));
      await refuses(pool, ctx, "unlink a foreign campaign's list", links, (db) => unlinkPopulation(db, sponsor, F.campaign!, F.population!));
    }
  }
  if (F.engagement) {
    await refuses(pool, ctx, "engagement recompute on the shared account leaves the foreign score alone", row("engagement_scores", F.engagement), (db) => deriveEngagement(db, { orgId: sponsor, companyId: ctx.account }));
  }
  await refuses(pool, ctx, "engagement signals on the shared account leave foreign evidence alone",
    async (db) => (await db.query(`select count(*)::int n from evidence where org_id = $1`, [ctx.foreignOrg])).rows[0],
    (db) => emitEngagementSignals(db, { orgId: sponsor, companyId: ctx.account }));
  // A partnership and joint pursuit the sponsor is NOT a party to — between the foreign tenant and a third
  // org — created inside the probe's own transaction (rolled back). The sponsor tries to push its own
  // evidence into it and to inject broker entries into its shared ledger; both must leave zero rows.
  await inTx(pool, sponsor, async (db) => {
    const third = (await db.query<{ id: string }>(`select id from organizations where id <> $1 and id <> $2 order by created_at limit 1`, [sponsor, ctx.foreignOrg])).rows[0]?.id;
    const ownEvidence = (await db.query<{ id: string }>(`select id from evidence where org_id = $1 order by collected_at limit 1`, [sponsor])).rows[0]?.id;
    if (!third || !ownEvidence) { check("party-check probes: a third org and sponsor evidence exist", false); return; }
    const ps = randomUUID(), jp = randomUUID();
    await db.query(`insert into partnerships (id, initiator_org_id, counterpart_org_id, invite_code, status, activated_at) values ($1, $2, $3, $4, 'active', now())`, [ps, ctx.foreignOrg, third, `h1a-probe-${ps}`]);
    await db.query(`insert into joint_pursuits (id, partnership_id, company_id, name, status, proposed_by_org) values ($1, $2, $3, 'ZZLEAK joint pursuit', 'active', $4)`, [jp, ps, ctx.account, ctx.foreignOrg]);
    const attempt = async (label: string, fn: () => Promise<unknown>, count: string, id: string) => {
      let outcome = "no-op";
      await db.query("savepoint party");
      try { await fn(); await db.query("release savepoint party"); }
      catch (e) { outcome = `refused: ${(e as Error).message.split("\n")[0].slice(0, 60)}`; await db.query("rollback to savepoint party"); }
      const n = Number((await db.query<{ n: string }>(count, [id])).rows[0].n);
      check(`write — ${label} (${outcome})`, n === 0, `${n} row(s) written`);
    };
    await attempt("offer evidence into a partnership the sponsor is not party to", () => offerEvidenceShare(db, sponsor, ps, ownEvidence),
      `select count(*)::text n from evidence_shares where partnership_id = $1`, ps);
    await attempt("broker-propose into a joint pursuit the sponsor is not party to", () => brokerPropose(db, sponsor, jp),
      `select count(*)::text n from joint_pursuit_events where pursuit_id = $1`, jp);
  });

  // ── Pursuits, routes, motions, goals, federation (lane B) ────────────────────────────────────
  await lanePursuitProbes(pool, ctx);
}
