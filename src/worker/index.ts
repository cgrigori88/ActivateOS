import http from "node:http";
import { getPool } from "../db/client";
import { importAccountsCsv } from "../lib/ingest/ingest-accounts";
import { runPendingResearchLocked } from "../lib/intel/research-runner";
import { runScreeningSweepAllOrgs, runScreeningSweepLocked } from "../lib/intel/screen-runner";
import { drainScheduledTouches } from "../lib/comms/sequence";
import { suggestCampaigns } from "../lib/comms/suggest";

/**
 * Pipeline worker (Railway). A single long-lived process that drives the
 * autonomous loop two ways, both reusing the SAME locked library:
 *
 *   1. HTTP trigger — POST /screen and POST /research, authenticated with the
 *      trigger secret. Because this is a real long-lived Node process (not a
 *      serverless function), a full batch runs with NO timeout.
 *   2. Internal scheduler — screening daily, research every few hours. The
 *      shared Postgres advisory lock keeps scheduled and on-demand runs from
 *      overlapping (a locked-out run returns immediately).
 *
 * Config (env): PORT (Railway sets it), RESEARCH_TRIGGER_SECRET (required to
 * enable triggers), WORKER_CRON=off to disable the internal scheduler,
 * SCREEN_HOUR_UTC (default 7), RESEARCH_INTERVAL_HOURS (default 6),
 * SWEEP_LIMIT (default 25), RESEARCH_LIMIT (default 25).
 */

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.RESEARCH_TRIGGER_SECRET ?? "";
const SWEEP_LIMIT = Number(process.env.SWEEP_LIMIT ?? 25);
const RESEARCH_LIMIT = Number(process.env.RESEARCH_LIMIT ?? 25);

function log(msg: string, extra?: unknown): void {
  const line = `[worker ${new Date().toISOString()}] ${msg}`;
  if (extra !== undefined) console.log(line, JSON.stringify(extra));
  else console.log(line);
}

// ── Pipeline actions (shared by HTTP + scheduler) ────────────────────────────

async function runScreen(limit = SWEEP_LIMIT) {
  const pool = getPool();
  const db = await pool.connect();
  try {
    return await runScreeningSweepAllOrgs(db, { limit });
  } finally {
    db.release();
  }
}

async function runResearch(limit = RESEARCH_LIMIT) {
  const pool = getPool();
  const db = await pool.connect();
  try {
    return await runPendingResearchLocked(db, { limit });
  } finally {
    db.release();
  }
}

async function runOutreach() {
  const pool = getPool();
  const db = await pool.connect();
  try {
    return await drainScheduledTouches(db);
  } finally {
    db.release();
  }
}

async function runSuggest(limit: number) {
  const pool = getPool();
  const db = await pool.connect();
  try {
    return await suggestCampaigns(db, { limit });
  } finally {
    db.release();
  }
}

async function queueStatus() {
  const pool = getPool();
  const { rows } = await pool.query<{ status: string; n: string }>(
    `select status, count(*) as n from research_jobs group by status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

async function runImport(
  csv: string,
  meta: { orgName: string; partnerName?: string; partnerType?: string; filename?: string; uploadedBy?: string },
) {
  const pool = getPool();
  const db = await pool.connect();
  try {
    return await importAccountsCsv(db, { ...meta, csv });
  } finally {
    db.release();
  }
}

/**
 * Fire-and-forget screen of an org after an import (user chose auto-queue).
 * Bounded so a large upload doesn't run up a surprise bill in one shot — the
 * daily scheduler drains the rest over subsequent passes.
 */
function screenOrgInBackground(orgId: string, limit = 50): void {
  void (async () => {
    const pool = getPool();
    const db = await pool.connect();
    try {
      const r = await runScreeningSweepLocked(db, orgId, { limit });
      log("post-import screen", r.locked ? { locked: true } : { screened: r.screened, enqueued: r.enqueued });
    } catch (err) {
      log("post-import screen error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      db.release();
    }
  })();
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── HTTP trigger server ──────────────────────────────────────────────────────

function authorized(req: http.IncomingMessage, url: URL): boolean {
  if (!SECRET) return false; // triggers closed until a secret is configured
  const bearer = (req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
  return bearer === SECRET || url.searchParams.get("key") === SECRET;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";

  // Health check is unauthenticated so Railway can probe it.
  if (method === "GET" && url.pathname === "/health") {
    return send(res, 200, { status: "ok" });
  }
  if (!authorized(req, url)) return send(res, 401, { error: "unauthorized" });

  try {
    if (method === "GET" && url.pathname === "/status") {
      return send(res, 200, { queue: await queueStatus() });
    }
    if (method === "POST" && url.pathname === "/screen") {
      const limit = Number(url.searchParams.get("limit") ?? SWEEP_LIMIT) || SWEEP_LIMIT;
      log("http: screen", { limit });
      const result = await runScreen(limit);
      return send(res, result.locked ? 409 : 200, result);
    }
    if (method === "POST" && url.pathname === "/research") {
      const limit = Number(url.searchParams.get("limit") ?? RESEARCH_LIMIT) || RESEARCH_LIMIT;
      log("http: research", { limit });
      const result = await runResearch(limit);
      return send(res, result.locked ? 409 : 200, result);
    }
    if (method === "POST" && url.pathname === "/suggest") {
      const limit = Number(url.searchParams.get("limit") ?? 3) || 3;
      log("http: suggest", { limit });
      return send(res, 200, await runSuggest(limit));
    }
    if (method === "POST" && url.pathname === "/outreach") {
      log("http: outreach drain");
      const result = await runOutreach();
      return send(res, 200, result);
    }
    if (method === "POST" && url.pathname === "/import") {
      const csv = await readBody(req);
      if (!csv.trim()) return send(res, 400, { error: "empty body — POST the CSV content" });
      const meta = {
        orgName: url.searchParams.get("org") ?? "Production",
        partnerName: url.searchParams.get("partner") ?? undefined,
        partnerType: url.searchParams.get("partnerType") ?? undefined,
        filename: url.searchParams.get("filename") ?? undefined,
        uploadedBy: url.searchParams.get("by") ?? undefined,
      };
      log("http: import", { org: meta.orgName, partner: meta.partnerName, bytes: csv.length });
      const result = await runImport(csv, meta);
      // Auto-queue a screen of the just-imported accounts (user's choice).
      screenOrgInBackground(result.orgId);
      return send(res, 200, { status: "ok", ...result });
    }
    return send(res, 404, { error: "not found" });
  } catch (err) {
    log("http error", { error: err instanceof Error ? err.message : String(err) });
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Internal scheduler (dependency-free minute ticker) ───────────────────────

function startScheduler(): void {
  if ((process.env.WORKER_CRON ?? "on").toLowerCase() === "off") {
    log("scheduler disabled (WORKER_CRON=off)");
    return;
  }
  const screenHour = Number(process.env.SCREEN_HOUR_UTC ?? 7);
  const researchIntervalMs = Number(process.env.RESEARCH_INTERVAL_HOURS ?? 6) * 3_600_000;
  const autosend = process.env.OUTREACH_AUTOSEND === "on";
  let lastResearch = Date.now(); // first research fires after one interval
  let lastScreenDay = ""; // YYYY-MM-DD of the last screening sweep

  log("scheduler on", { screenHour, researchIntervalHours: researchIntervalMs / 3_600_000, outreachAutosend: autosend });

  const tick = async () => {
    const now = new Date();
    // Research: every N hours.
    if (Date.now() - lastResearch >= researchIntervalMs) {
      lastResearch = Date.now();
      try {
        const r = await runResearch();
        log("cron: research", r.locked ? { locked: true } : { done: r.done, failed: r.failed });
      } catch (err) {
        log("cron: research error", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Outreach: drain due scheduled touches (only sends when armed).
    if (autosend) {
      try {
        const o = await runOutreach();
        if (o.sent > 0 || o.errors.length > 0) log("cron: outreach", o);
      } catch (err) {
        log("cron: outreach error", { error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Screen: once per day at the target UTC hour.
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === screenHour && lastScreenDay !== day) {
      lastScreenDay = day;
      try {
        const s = await runScreen();
        log("cron: screen", s.locked ? { locked: true } : { screened: s.screened, enqueued: s.enqueued });
      } catch (err) {
        log("cron: screen error", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  setInterval(() => void tick(), 60_000);
}

server.listen(PORT, () => {
  log(`listening on :${PORT}`, {
    triggers: SECRET ? "enabled" : "DISABLED (set RESEARCH_TRIGGER_SECRET)",
  });
  startScheduler();
});

// Keep the process alive and log fatal errors rather than dying silently.
process.on("unhandledRejection", (err) => log("unhandledRejection", { error: String(err) }));
process.on("SIGTERM", () => {
  log("SIGTERM — shutting down");
  server.close(() => process.exit(0));
});
