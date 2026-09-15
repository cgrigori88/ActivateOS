import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { goalChain } from "../src/lib/goals/chain";
import { listGoals } from "../src/lib/goals/goals";
import { listTargets, upsertTarget } from "../src/lib/goals/targets";
import { approveMotion } from "../src/lib/motions/approve";
import { transitionMotion } from "../src/lib/motions/lifecycle";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { callerFor } from "../src/lib/pursuits/read-models/caller";
import { getPursuitDetail, getPursuitTeam } from "../src/lib/pursuits/read-models/detail";
import { getPursuitPortfolio } from "../src/lib/pursuits/read-models/portfolio";
import { getRouteComparison } from "../src/lib/pursuits/read-models/route";
import { inTx, leaks, refuses, type ProbeCtx } from "./tenant-isolation-probes";

/** Pursuits, routes, motions and goals (the H1A audit's lane B) — as the sponsor, with foreign ids. */
export async function lanePursuitProbes(pool: Pool, ctx: ProbeCtx): Promise<void> {
  const { sponsor, foreign: F, foreignRx: rx, check } = ctx;
  const read = async (label: string, fn: (db: PoolClient) => Promise<unknown>, extra?: (v: unknown) => string | null) => {
    let v: unknown; let err: string | null = null;
    try { v = await inTx(pool, sponsor, fn); } catch (e) { err = (e as Error).message.split("\n")[0]; }
    const l = err ? null : (leaks(v, rx) ?? extra?.(v) ?? null);
    check(`read — ${label}: no foreign data`, !err && !l, err ? `threw: ${err}` : (l ?? ""));
  };

  await read("pursuit portfolio", async (db) => getPursuitPortfolio(db, await callerFor(db, sponsor)));
  if (F.pursuit) {
    await read("pursuit detail of a foreign pursuit id (must be null → not-found)", async (db) => getPursuitDetail(db, await callerFor(db, sponsor), F.pursuit!),
      (v) => (v == null ? null : "a foreign pursuit's detail was returned"));
    await read("route comparison of a foreign pursuit id", async (db) => getRouteComparison(db, await callerFor(db, sponsor), F.pursuit!),
      (v) => ((v as { path?: unknown[] })?.path?.length ? "a foreign route path was returned" : null));
    await read("pursuit team of a foreign pursuit id", async (db) => getPursuitTeam(db, await callerFor(db, sponsor), F.pursuit!));
  }
  await read("goals list (counts and rollups)", (db) => listGoals(db, sponsor));
  await read("revenue targets (actuals by partner)", (db) => listTargets(db, sponsor));
  if (F.goal) {
    let chain: unknown = null, threw = false;
    try { chain = await inTx(pool, sponsor, (db) => goalChain(db, sponsor, F.goal!)); } catch { threw = true; }
    check("read — goal chain of a foreign goal id: no foreign data", threw || !leaks(chain, rx));
  }

  // ── Governed writes (dispatchSkill) and direct writes, with foreign ids ─────────────────────
  const actor: Actor = { type: "USER", id: null, orgId: sponsor, role: "operator" };
  if (F.pursuit) {
    const pursuitState = async (db: PoolClient) => ({
      p: (await db.query(`select selected_partner_id, status from pursuits where id = $1`, [F.pursuit])).rows[0],
      s: (await db.query(`select route_status, selected_partner_id from pursuit_route_snapshots where pursuit_id = $1 order by seq`, [F.pursuit])).rows,
      t: (await db.query(`select count(*)::int n from pursuit_team_members where pursuit_id = $1`, [F.pursuit])).rows[0],
    });
    for (const skill of ["select_partner_route", "override_partner_route", "assemble_pursuit_team"]) {
      await refuses(pool, ctx, `governed ${skill} on a foreign pursuit`, pursuitState, async (db) => {
        const r = await dispatchSkill(db, skill, actor, {
          pursuitId: F.pursuit!, args: { candidateKey: randomUUID(), reason: "probe", category: "RELATIONSHIP_KNOWLEDGE" },
          correlationId: null, dataEnvironment: "DEMO", idempotencyKey: `h1a-probe:${skill}:${randomUUID()}`,
        } as never);
        if (r.status === "EXECUTED") throw new Error(`EXECUTED (should have been refused)`);
        return r;
      });
    }
  }
  const motionRow = (id: string | null) => async (db: PoolClient) => id ? (await db.query(`select status, approved_at, activated_at, closed_at from revenue_motions where id = $1`, [id])).rows[0] : null;
  if (F.motionDraft) await refuses(pool, ctx, "approve a foreign draft motion", motionRow(F.motionDraft), (db) => approveMotion(db, sponsor, F.motionDraft!));
  if (F.motionDraft) {
    await refuses(pool, ctx, "governed approve_motion on a foreign motion", motionRow(F.motionDraft), async (db) => {
      const r = await dispatchSkill(db, "approve_motion", actor, { args: { motionId: F.motionDraft }, correlationId: null, dataEnvironment: "DEMO", idempotencyKey: `h1a-probe:approve:${randomUUID()}` } as never);
      if (r.status === "EXECUTED") throw new Error("EXECUTED (should have been refused)");
      return r;
    });
  }
  if (F.motionActive) await refuses(pool, ctx, "transition a foreign active motion", motionRow(F.motionActive), (db) => transitionMotion(db, sponsor, F.motionActive!, "abandoned", {} as never));
  if (F.partner) {
    await refuses(pool, ctx, "set a revenue target on a foreign partner",
      async (db) => (await db.query(`select count(*)::int n from revenue_targets where partner_id = $1`, [F.partner])).rows[0],
      (db) => upsertTarget(db, { orgId: sponsor, partnerId: F.partner!, periodYear: 2026, metric: "pipeline" as never, targetUsd: 1 }));
  }
}
