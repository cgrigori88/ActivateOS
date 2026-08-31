import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { buildInfo, databaseIdentity, environmentLabel, externalSendingArmed, siteMode } from "@/lib/env/environment";

export const dynamic = "force-dynamic";

/**
 * Build fingerprint (§15) — "we should never again need to fingerprint CSS to
 * identify what version is deployed."
 *
 * That sentence is the whole specification. During the reconciliation pass the
 * only way to establish which commit was live was to fetch the deployed CSS
 * bundle and diff its custom properties against git history. It worked, and it
 * should never have been necessary.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN: any secret, any connection string,
 * any tenant data, any row count. The database is identified by its Supabase
 * project ref, which is not a secret — it is a substring of the public API URL
 * that ships in the client bundle. Naming it here tells an operator *which*
 * database this deployment reached, which is precisely the question that took a
 * forensic pass to answer, and it discloses nothing that was private.
 *
 * ACCESS. Two independent layers:
 *   1. src/proxy.ts already gates this path (its matcher excludes only the
 *      signature-authenticated webhook routes), so on any deployment with Basic
 *      Auth or identity configured, an anonymous caller never arrives here.
 *   2. The check below, which does not trust layer 1. Local dev runs with no
 *      gate at all, and a future matcher edit should not silently make this
 *      public. Either an authenticated session or OPS_FINGERPRINT_TOKEN.
 *
 * The token exists so this stays usable in exactly the situation it is for:
 * diagnosing a deployment whose database or auth is the thing that is broken.
 */

function tokenMatches(presented: string | null): boolean {
  const expected = process.env.OPS_FINGERPRINT_TOKEN;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorized(): Promise<boolean> {
  const h = await headers();
  if (tokenMatches(h.get("x-ops-token"))) return true;

  // A signed-in user of this deployment is an operator for fingerprint purposes:
  // the commit and the project ref are not commercially sensitive, and gating
  // this behind owner-role would need a database read — unavailable in the very
  // failure mode this endpoint is meant to diagnose.
  if (authConfigured()) {
    try {
      const supabase = await supabaseServer();
      if ((await supabase.auth.getUser()).data.user) return true;
    } catch {
      /* auth unreachable — fall through to refuse */
    }
  }
  return false;
}

export async function GET() {
  if (!(await authorized())) {
    // 404, not 403: an unauthenticated caller learns nothing about whether this
    // deployment has an ops surface at all.
    return new NextResponse("Not found", { status: 404 });
  }

  const build = buildInfo();
  const db = databaseIdentity();

  return NextResponse.json(
    {
      environment: siteMode(),
      environmentLabel: environmentLabel(),
      commit: build.commit ?? "unknown",
      // The full SHA is what a human compares against `git log`; the short form
      // is what they can hold in their head while doing it.
      commitShort: build.commit ? build.commit.slice(0, 7) : "unknown",
      branch: build.ref ?? "unknown",
      builtAt: build.builtAt ?? "unknown",
      deploymentId: build.deploymentId ?? "unknown",
      vercelEnv: build.vercelEnv ?? "unknown",
      database: {
        // Non-secret identifiers only — see the header comment.
        projectRef: db.projectRef ?? "unknown",
        host: db.host ?? "unknown",
      },
      posture: {
        // The two facts most often asserted from memory and most worth checking
        // against the running process instead.
        externalSendingArmed: externalSendingArmed(),
        modelCredentialPresent: Boolean(process.env.ANTHROPIC_API_KEY),
      },
      serverTime: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
