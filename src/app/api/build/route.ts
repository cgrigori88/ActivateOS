import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { getPool } from "@/db/client";
import { withTenantOrg } from "@/lib/db/tenant";
import { type DatabasePosture, probeDatabasePosture } from "@/lib/env/db-posture";
import { buildInfo, databaseIdentity, environmentLabel, externalSendingArmed, governedAgentEnforcementEnabled, planContentV2WritesEnabled, siteMode } from "@/lib/env/environment";
import { interpreterEnabled } from "@/lib/interpret/answer";
import { intentCredentialPresent, intentModelEnabled } from "@/lib/experience/intent/model";
import { vnextCapabilities } from "@/lib/env/vnext-flags";
import { tenantFeatures } from "@/lib/pursuits/tenant-flags";

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
  // H1B Gate 6: the live posture of the RUNTIME pool — role, whether it bypasses RLS, and whether RLS
  // therefore binds it. Never throws and never waits more than two seconds (see db-posture.ts).
  let live: DatabasePosture = { status: "unavailable" };
  try { live = await probeDatabasePosture(getPool()); } catch { /* DATABASE_URL unset — report unavailable */ }

  /**
   * P7 Slice 6 H0 — the CANONICAL capability evaluator's own answer, per organization.
   *
   * Env-var names are not an authorization answer, so this reports what `vnextCapabilities` actually
   * returns for each tenant. `withoutDynamicSurfaces` is the same evaluator run with that ONE master
   * forced off, so the activation delta is attributable to exactly one variable rather than inferred.
   * Booleans and organization names only — no env values, no secrets, no tenant data.
   */
  let capabilities: unknown = null;
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; name: string }>(
      "select id, name from organizations order by name");
    const real = process.env.VNEXT_DYNAMIC_SURFACES_ENABLED;
    capabilities = [];
    for (const org of rows) {
      // `org_features` is RLS-bound: read WITHOUT the tenant GUC and it returns no row, which
      // `orgRow` fail-closes to all-false. That would report a denial as a capability. So this
      // reads through the same tenant-pinned primitive every governed read uses.
      const entry = await withTenantOrg(org.id, async (db) => {
        const tenant = await tenantFeatures(db, org.id);
        const actual = vnextCapabilities(tenant);
        // The counterfactual: identical inputs, this one master off.
        delete process.env.VNEXT_DYNAMIC_SURFACES_ENABLED;
        const without = vnextCapabilities(tenant);
        if (real === undefined) delete process.env.VNEXT_DYNAMIC_SURFACES_ENABLED;
        else process.env.VNEXT_DYNAMIC_SURFACES_ENABLED = real;
        return { org: org.name, tenantExperience: tenant.experience, actual, withoutDynamicSurfaces: without };
      });
      (capabilities as unknown[]).push(entry);
    }
  } catch { capabilities = null; }

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
        // Runtime posture (H1B Gate 6). `role` is the live current_user when the probe answers, else
        // the role name parsed from the connection string's user (never the password). `bypassRls` /
        // `tenantEnforcement` are null when the probe could not answer — never guessed.
        role: live.status === "live" ? live.role : (db.role ?? "unknown"),
        bypassRls: live.status === "live" ? live.bypassRls : null,
        tenantEnforcement: live.status === "live" ? live.tenantEnforcement : null,
        probe: live.status,
      },
      posture: {
        // The two facts most often asserted from memory and most worth checking
        // against the running process instead.
        externalSendingArmed: externalSendingArmed(),
        modelCredentialPresent: Boolean(process.env.ANTHROPIC_API_KEY),
        // P7 Slice 5 posture. Presence only — never the key, a prefix, a hash or a length. The
        // capability switch and the credential are reported separately BECAUSE they are separate:
        // a credential is a capability-scoped input, never ambient application authority.
        interpreterEnabled: interpreterEnabled(),
        intentEnabled: intentModelEnabled(),
        intentCredentialPresent: intentCredentialPresent(),
        // P3 Slice 2C-A ROLLOUT POSTURE — may this deployment PERSIST a schema-2 plan revision?
        // It belongs here and NOT in `capabilities`: that array is per-tenant product entitlement,
        // while this is a deployment-global write brake that decides whether the database is still
        // on the safe side of the rollback boundary. A hosted gate has to be able to prove that
        // from the running process rather than from someone's memory of a Vercel setting.
        planContentV2WritesEnabled: planContentV2WritesEnabled(),
        // P45-4 AUTHORITY POSTURE — does this deployment REQUIRE an AGENT to act as a governed
        // actor holding an exact live grant? Same reasoning as the line above, and the same reason
        // it is not in `capabilities`: this is not per-tenant entitlement, it is a deployment-global
        // authority requirement, and which side of the bound-credential boundary an environment is
        // on must be answerable FROM THE RUNNING PROCESS rather than from someone's memory of a
        // Vercel setting. Absent ⇒ false ⇒ the certified legacy AGENT contract is in force.
        governedAgentEnforcementEnabled: governedAgentEnforcementEnabled(),
      },
      capabilities,
      serverTime: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
