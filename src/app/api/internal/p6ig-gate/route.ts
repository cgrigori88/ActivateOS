/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TEMPORARY — P6-IG HOSTED ACCEPTANCE GATE. PREVIEW ONLY. NOT A PRODUCT CAPABILITY.
 *
 * REMOVED, WITH ITS MODULES, BEFORE P6-IG CAN BE MARKED HOSTED CLOSED. Its only purpose is to run
 * the P6-IG acceptance matrix under the deployed Preview runtime's own `app_rw` credential, whose
 * plaintext is unrecoverable locally and must not be rotated. No other route imports it, and
 * nothing in the product reaches it.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * IT REFUSES UNLESS ALL OF THESE HOLD, in this order, before a connection is opened:
 *   1. VERCEL_ENV is `preview`                     — never production, never a local build
 *   2. siteMode() is `demo`                        — the synthetic environment, by its own identity
 *   3. the deployment's branch is roadmap/pursuitos-vnext
 *   4. a valid ops token (timing-safe), the same mechanism /api/build uses
 *   5. DATABASE_URL resolves to the Preview Supabase project, and NEVER the production project —
 *      parsed for its project ref alone; the string itself is never logged or returned
 * and then, once connected, before a single acceptance check runs:
 *   6. the session is a real password-authenticated `app_rw`: session_user = current_user = app_rw,
 *      LOGIN, NOT BYPASSRLS, NOT SUPERUSER, NOINHERIT, no memberships, no CREATE on public.
 * A failure at 6 ABORTS THE HARNESS with the authority evidence and no test results.
 *
 * INPUT. No request body. One query parameter, `part`, matched against a fixed enumeration; an
 * unknown value is refused. No SQL, table, column or identifier is ever taken from the caller.
 * OUTPUT. Check names, booleans, counts and sanitized detail. Never a row value, a connection
 * string, a credential, or any part of process.env.
 * WRITES. None. Negative controls run inside savepoints and the transaction always rolls back.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/db/client";
import { buildInfo, siteMode } from "@/lib/env/environment";
import { Checks, PARTS, type Part, findFixture, proveAuthority, runConstraints, runWrites } from "./checks";
import { runDerivation, runDisclosure, runSharing, runTemporal } from "./governance-checks";

export const dynamic = "force-dynamic";

const PREVIEW_REF = "mejokqxriwyawfhawuxu";
const PRODUCTION_REF = "qifatlqxfuhwrwvpbwsc";
const BRANCH = "roadmap/pursuitos-vnext";

function tokenMatches(presented: string | null): boolean {
  const expected = process.env.OPS_FINGERPRINT_TOKEN;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The project ref only — the connection string is never returned, logged or otherwise revealed. */
function databaseRef(): string | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const user = decodeURIComponent(u.username);
    const fromUser = user.includes(".") ? user.slice(user.indexOf(".") + 1) : null;
    const fromHost = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)?.[1] ?? null;
    return fromUser ?? fromHost;
  } catch {
    return null;
  }
}

const refuse = (why: string) => new NextResponse(JSON.stringify({ harness: "p6ig-gate", refused: why }), {
  status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export async function GET(req: Request): Promise<NextResponse> {
  // 1–3: environment, identity and branch, before anything else.
  if ((process.env.VERCEL_ENV ?? "") !== "preview") return refuse("not a Preview deployment");
  let mode: string;
  try { mode = siteMode(); } catch { return refuse("environment identity unresolved"); }
  if (mode !== "demo") return refuse("not the demo environment");
  if ((buildInfo().ref ?? "") !== BRANCH) return refuse("not the authorized branch");

  // 4: the ops token, the same gate /api/build uses. 404, never 403 — an unauthorized caller
  // learns nothing about whether this surface exists.
  const h = await headers();
  if (!tokenMatches(h.get("x-ops-token"))) return refuse("unauthorized");

  // 5: the database this runtime is wired to.
  const ref = databaseRef();
  if (ref === PRODUCTION_REF) return refuse("refusing: the runtime names the PRODUCTION project");
  if (ref !== PREVIEW_REF) return refuse("refusing: the runtime does not name the Preview project");

  const requested = new URL(req.url).searchParams.get("part") ?? "";
  if (!(PARTS as readonly string[]).includes(requested)) {
    return NextResponse.json({ harness: "p6ig-gate", error: "unknown part", parts: PARTS }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const part = requested as Part;

  const authority = new Checks();
  const checks = new Checks();
  const db = await getPool().connect();
  let fixtureFound = false;
  try {
    // Everything runs in ONE transaction that always rolls back.
    await db.query("begin");

    // 6 — D: prove the credential BEFORE any fixture or test operation.
    const authorized = await proveAuthority(db, authority);
    if (!authorized) {
      await db.query("rollback");
      return NextResponse.json({
        harness: "p6ig-gate", part, aborted: true,
        reason: "ABORTED BEFORE TEST EXECUTION — the runtime session is not a verified app_rw",
        authority: { passed: authority.passed, failed: authority.failed, checks: authority.results },
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }

    const fixture = await findFixture(db);
    fixtureFound = fixture !== null;
    if (!fixture) {
      await db.query("rollback");
      return NextResponse.json({
        harness: "p6ig-gate", part, aborted: true,
        reason: "the acceptance fixture is not present (it is planted and removed by the owner, out of band)",
        authority: { passed: authority.passed, failed: authority.failed },
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }

    switch (part) {
      case "identity": break; // the authority block above IS this part
      case "constraints": await runConstraints(db, checks, fixture); break;
      case "derivation": await runDerivation(db, checks, fixture); break;
      case "temporal": await runTemporal(db, checks, fixture); break;
      case "sharing": await runSharing(db, checks, fixture); break;
      case "disclosure": await runDisclosure(db, checks, fixture); break;
      case "writes": await runWrites(db, checks, fixture); break;
    }

    // Nothing this harness did may survive.
    const xid = (await db.query<{ x: string | null }>(`select txid_current_if_assigned()::text as x`)).rows[0]?.x ?? null;
    await db.query("rollback");
    return NextResponse.json({
      harness: "p6ig-gate", part, aborted: false, fixtureFound,
      authority: { passed: authority.passed, failed: authority.failed, checks: authority.results },
      result: { passed: checks.passed, failed: checks.failed, checks: checks.results },
      transaction: { rolledBack: true, wroteRows: false, xidAssignedDuringRun: xid !== null },
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    await db.query("rollback").catch(() => {});
    // The message is scrubbed of anything that could carry a connection string.
    const msg = String((e as Error)?.message ?? "error").replace(/postgres(ql)?:\/\/\S+/g, "<redacted>").slice(0, 300);
    return NextResponse.json({
      harness: "p6ig-gate", part, aborted: true, reason: `harness error: ${msg}`,
      authority: { passed: authority.passed, failed: authority.failed },
      result: { passed: checks.passed, failed: checks.failed, checks: checks.results },
    }, { status: 500, headers: { "cache-control": "no-store" } });
  } finally {
    db.release();
  }
}
