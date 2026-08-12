import { NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { runPendingResearchLocked } from "@/lib/intel/research-runner";
import { secretEquals } from "@/lib/security/compare";
import { clientIp, rateLimited } from "@/lib/security/rate-limit";

/**
 * Deep-research trigger endpoint (§12). One HTTP surface for BOTH a scheduler
 * (cron POSTs here on an interval) and a manual trigger (a person/button POSTs
 * here on demand). The runner logic lives in the reusable library
 * (runPendingResearchLocked); this route is a thin, authenticated wrapper.
 *
 * Auth: a dedicated bearer secret (RESEARCH_TRIGGER_SECRET), NOT the app's
 * Basic Auth — so automation can call it without interactive credentials. The
 * route is exempt from the Basic Auth middleware; if the secret is unset the
 * endpoint is closed (401), never open.
 *
 * Concurrency: the library holds a global advisory lock, so an overlapping call
 * returns 409 instead of double-spending on deep research.
 */

export const dynamic = "force-dynamic";
// If deployed on a serverless host, allow a longer window for a batch; ignored
// elsewhere. Keep per-call `limit` small on time-boxed platforms.
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.RESEARCH_TRIGGER_SECRET;
  if (!secret) return false; // closed until configured
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return secretEquals(bearer, secret) || secretEquals(key, secret);
}

/** Failed auths are secret guesses — throttle them (#66); callers with the
    real secret are never limited. Returns the refusal response. */
function refuse(req: Request): NextResponse {
  if (rateLimited(`research:${clientIp(req.headers)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "too many attempts" }, { status: 429 });
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** GET: queue status (pending/running counts + recent finished jobs). */
export async function GET(req: Request): Promise<NextResponse> {
  if (!authorized(req)) return refuse(req);
  const pool = getPool();
  const { rows: counts } = await pool.query<{ status: string; n: string }>(
    `select status, count(*) as n from research_jobs group by status`,
  );
  const { rows: recent } = await pool.query(
    `select r.reason, r.status, r.detail, r.finished_at, c.legal_name as company
     from research_jobs r join companies c on c.id = r.company_id
     where r.finished_at is not null
     order by r.finished_at desc limit 10`,
  );
  return NextResponse.json({
    queue: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    recent,
  });
}

/** POST: drain the queue once (under the global lock). */
export async function POST(req: Request): Promise<NextResponse> {
  if (!authorized(req)) return refuse(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 100);
  const orgId = url.searchParams.get("orgId") ?? undefined;

  const pool = getPool();
  const db = await pool.connect();
  try {
    const result = await runPendingResearchLocked(db, { limit, orgId });
    if (result.locked) {
      return NextResponse.json(
        { status: "locked", message: "a research run is already in progress" },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  } finally {
    db.release();
  }
}
