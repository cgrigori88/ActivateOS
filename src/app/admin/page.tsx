import Link from "next/link";
import { headers } from "next/headers";
import { getOwnerPool } from "@/db/client";
import { Bento, Button, Card, PageHeader, fieldClass, BlockLabel } from "@/components/ui";
import { currentRole } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { byoModelAvailable, hasOrgAnthropicKey } from "@/lib/ai/org-keys";
import { authConfigured } from "@/lib/auth/supabase";
import {
  inviteMemberAction, setMemberRoleAction, removeMemberAction,
  createInviteAction, redeemInviteAction, revokePartnershipAction,
  offerGrantAction, acceptGrantAction, declineGrantAction, revokeGrantAction, syncGrantAction,
  requestOverlapAction, decideOverlapAction,
  mintApiKeyAction, revokeApiKeyAction,
  setOrgAiKeyAction,
  clearOrgAiKeyAction,
  saveIcpAction, addSuppressionAction, removeSuppressionAction,
  previewDataSubjectAction, eraseDataSubjectAction,
} from "./actions";
import { icpFit, listSuppressions, loadIcp, type IcpFit } from "@/lib/icp/icp";
import { AgentKeys, type KeyRow } from "./agent-keys";
import { auditEntries, listGrantViews, listPartnerships } from "@/lib/partnerships/partnerships";
import { orgKind } from "@/lib/partnerships/guest";
import { buttonClass } from "@/components/ui";
import {
  OVERLAP_LEVELS, LEVEL_LABEL, LEVEL_EXPLAIN, overlapLadder, bookSize,
  type BandsResults, type CountsResults, type NamedResults, type OverlapLadder,
} from "@/lib/partnerships/overlap";
import { formatCost } from "@/lib/format/money";

export const dynamic = "force-dynamic";

/**
 * Admin (task #64) — the platform-operations side of the app, owners only.
 * Two concerns, one room:
 *  - ACCESS: who is in the org and what they may do (invite / role / remove).
 *  - AI OPERATIONS: what the agents and providers are doing — runs, spend,
 *    latency, human overrides, provider errors, queue depth. The observability
 *    that was deliberately removed from user-facing Insights lives here, where
 *    the audience is the platform operator.
 */

const ROLES = ["owner", "operator", "viewer"] as const;
const ROLE_HINT: Record<string, string> = {
  owner: "Runs the org's people + everything below",
  operator: "Runs the org's data — approve, send, edit",
  viewer: "Read-only everywhere",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; next?: string }>;
}) {
  const sp = await searchParams;
  // RISK-1: role gate + the members table (which joins auth.users) run on the
  // OWNER pool — app_rw cannot read the `auth` schema. Everything else is
  // org-scoped DATA and runs inside a single withTenant transaction, so under
  // app_rw every read is RLS-pinned to this org. (This also closes a latent
  // leak: the AI-operations reads below were previously unscoped and, on the
  // owner pool, surfaced every tenant's runs to any owner.)
  const ownerPool = getOwnerPool();
  const role = await currentRole(ownerPool);

  if (role !== "owner") {
    return (
      <main>
        <PageHeader title="Admin" subtitle="Platform operations." />
        <Card><p className="text-copy text-neutral-500">Owner access required — ask an owner of your organization.</p></Card>
      </main>
    );
  }

  const byoAvailable = byoModelAvailable();
  // Absolute base for shareable /join links — the invite code doubles as a
  // guest-seat claim URL (B+2).
  const hdrs = await headers();
  const joinBase = `https://${hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "pursuitos.io"}`;

  // ── Tenant-scoped reads (one transaction, RLS-pinned under app_rw) ──────────
  const t = await withTenant(async (db, orgId) => {
    const hasOwnKey = await hasOrgAnthropicKey(db, orgId);
    const isGuest = (await orgKind(db, orgId)) === "guest";

    // Partnerships + ledger
    const [partnerships, grants, ledger, { rows: myPartners }, { rows: myLists }] = await Promise.all([
      listPartnerships(db, orgId),
      listGrantViews(db, orgId),
      auditEntries(db, orgId, 25),
      db.query<{ id: string; name: string }>(
        `select id, name from partners where org_id = $1 order by name asc`,
        [orgId],
      ),
      db.query<{ id: string; name: string }>(
        `select id, name from account_populations
         where org_id = $1 and status = 'approved' and created_by is distinct from 'partner share'
         order by name asc`,
        [orgId],
      ),
    ]);
    const activePartnerships = partnerships.filter((p) => p.status === "active");

    // Blind overlap ladders — one per active partnership; sequential on the
    // shared pool client semantics (small N, no parallel query hazards).
    const ladders: (OverlapLadder & { otherOrgName: string | null })[] = [];
    let myBookSize = 0;
    if (activePartnerships.length > 0) {
      myBookSize = await bookSize(db, orgId);
      for (const p of activePartnerships) {
        const ladder = await overlapLadder(db, orgId, p.id);
        ladders.push({ ...ladder, otherOrgName: p.otherOrgName ?? p.myLensName });
      }
    }

    // Targeting (task #83): the ICP profile + suppression list, and a fit map
    // for every account in approved named-overlap results.
    const icp = await loadIcp(db, orgId);
    const suppressions = await listSuppressions(db, orgId);
    const fitById = new Map<string, IcpFit>();
    if (icp) {
      const namedIds = new Set<string>();
      for (const l of ladders) {
        const rung = l.rungs.named;
        if (rung.state === "approved") {
          for (const a of (rung.results as NamedResults).accounts) namedIds.add(a.company_id);
        }
      }
      if (namedIds.size > 0) {
        const { rows } = await db.query<{ id: string; industry: string | null; employee_count: number | null; country: string | null }>(
          `select id, industry, employee_count, country from companies where id = any($1)`,
          [[...namedIds]],
        );
        for (const c of rows) {
          fitById.set(c.id, icpFit(icp, { industry: c.industry, employeeCount: c.employee_count, country: c.country }));
        }
      }
    }

    // Agent API keys (task #76) — the BYO-bot surface.
    const { rows: apiKeys } = await db.query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>(
      `select id, name, created_at, last_used_at from api_keys
       where org_id = $1 and revoked_at is null order by created_at desc`,
      [orgId],
    );

    // ── AI operations (now org-scoped by RLS) ────────────────────────────────
    const [{ rows: agents }, { rows: recentRuns }, { rows: providerErrors }, { rows: queues }] = await Promise.all([
      db.query<{ workflow: string; n: string; cost: string | null; ms: string | null; overridden: string }>(
        `select workflow, count(*) as n, round(sum(cost_usd)::numeric, 3) as cost,
                round(avg(latency_ms))::int as ms,
                count(*) filter (where human_decision in ('edited','rejected')) as overridden
         from agent_runs group by workflow order by n desc`,
      ),
      db.query<{ workflow: string; model: string; cost_usd: string | null; latency_ms: number | null; human_decision: string | null; created_at: Date }>(
        `select workflow, model, cost_usd, latency_ms, human_decision, created_at
         from agent_runs order by created_at desc limit 10`,
      ),
      db.query<{ provider_id: string; error: string | null; status: string; finished_at: Date | null }>(
        `select provider_id, error, status, finished_at from provider_runs
         where status = 'failed' or error is not null
         order by finished_at desc nulls last limit 8`,
      ),
      db.query<{ research_pending: string; research_running: string; review_pending: string; touches_scheduled: string }>(
        `select
           (select count(*) from research_jobs where status = 'pending') as research_pending,
           (select count(*) from research_jobs where status = 'running') as research_running,
           (select count(*) from review_queue where status = 'pending') as review_pending,
           (select count(*) from campaign_touches where status = 'scheduled') as touches_scheduled`,
      ),
    ]);

    return {
      orgId, hasOwnKey, isGuest,
      partnerships, grants, ledger, myPartners, myLists, activePartnerships,
      ladders, myBookSize, icp, suppressions, fitById, apiKeys,
      agents, recentRuns, providerErrors, queues,
    };
  });

  const {
    orgId, hasOwnKey, isGuest,
    partnerships, grants, ledger, myPartners, myLists, activePartnerships,
    ladders, myBookSize, icp, suppressions, fitById, apiKeys,
    agents, recentRuns, providerErrors, queues,
  } = t;

  // ── Access: members join auth.users → OWNER pool ────────────────────────────
  // The `auth` schema is Supabase's, and it is not present (or not readable) in every environment
  // this app runs against — a local demo database has no `auth.users` at all. That was throwing
  // `permission denied for schema auth` and taking the WHOLE Admin room down with a 500, from a
  // link that appears in the rail on every page. One unavailable panel must not 500 a room: the
  // member list degrades to empty and the room renders everything else it knows.
  let members: { user_id: string; email: string | null; role: string; created_at: Date; last_sign_in_at: Date | null }[] = [];
  let membersUnavailable = false;
  if (orgId) {
    try {
      members = (await ownerPool.query<{ user_id: string; email: string | null; role: string; created_at: Date; last_sign_in_at: Date | null }>(
        `select m.user_id, u.email, m.role, m.created_at, u.last_sign_in_at
         from org_members m join auth.users u on u.id = m.user_id
         where m.org_id = $1 order by m.created_at asc`,
        [orgId],
      )).rows;
    } catch {
      membersUnavailable = true;
    }
  }

  const keyRows: KeyRow[] = apiKeys.map((k) => ({
    id: k.id,
    name: k.name,
    createdAt: new Date(k.created_at).toISOString().slice(0, 10),
    lastUsedAt: k.last_used_at ? new Date(k.last_used_at).toISOString().slice(0, 16).replace("T", " ") : null,
  }));
  const mcpEndpoint = `${process.env.APP_URL ?? "https://pursuitos.io"}/api/mcp`;

  const qd = queues[0];
  const totalRuns = agents.reduce((s, a) => s + Number(a.n), 0);
  const totalCost = agents.reduce((s, a) => s + Number(a.cost ?? 0), 0);

  // Worker heartbeat (only when configured; never blocks the page long).
  let workerStatus = "not configured";
  if (process.env.WORKER_URL) {
    try {
      const res = await fetch(`${process.env.WORKER_URL.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
      workerStatus = res.ok ? "healthy" : `unhealthy (${res.status})`;
    } catch {
      workerStatus = "unreachable";
    }
  }

  const input = "rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <main>
      <PageHeader
        title="Admin"
        subtitle="Access and AI operations. Owners only."
      />

      {sp.notice && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-inner border border-blue-300 bg-blue-50 px-4 py-2.5 text-copy text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
          <span>{sp.notice}</span>
          {/* Next-step pull (#79): a named overlap just opened the door to joint rooms. */}
          {sp.next === "joint" && (
            <Link
              href="/joint"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-body font-bold text-white shadow-[var(--shadow-float)] transition-colors duration-[140ms] hover:bg-blue-800"
            >
              Propose a joint pursuit
              <span aria-hidden>→</span>
            </Link>
          )}
        </div>
      )}

      {/* ── Guest workspace identity (B+2) ── */}
      {isGuest && (
        <Card tone="amber" className="mb-4">
          <BlockLabel>Guest workspace</BlockLabel>
          <p className="max-w-[88ch] text-copy text-neutral-600 dark:text-neutral-300">
            This is a free seat, created from a partner&apos;s invite. Everything in it is yours — your book, your
            contacts, your side of the trust ladder — behind the same tenant isolation as any workspace, and your
            partner sees only what you explicitly approve. The one cap: a guest workspace can&apos;t invite partners
            of its own. When you&apos;re ready to run your own partner network here, upgrading to a full workspace
            lifts it.
          </p>
        </Card>
      )}

      {/* ── Access ── */}
      <BlockLabel>Access</BlockLabel>
      <Card className="mb-4">
        {!authConfigured() ? (
          <p className="text-copy text-neutral-500">
            Identity isn&apos;t configured on this deployment — member management activates once
            <code className="mx-1">NEXT_PUBLIC_SUPABASE_*</code> is set. Basic Auth gates everything meanwhile.
          </p>
        ) : (
          <>
            {membersUnavailable ? (
              <p className="mb-3 rounded-inner border border-amber-300 bg-amber-50 px-3 py-2 text-copy text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                The identity directory isn&apos;t readable from this deployment&apos;s database, so the member list
                can&apos;t be shown. Everything else on this page is live — this panel alone is unavailable.
              </p>
            ) : members.length === 0 ? (
              <p className="mb-3 text-copy text-neutral-500">No members yet — create the owner on the <Link href="/login" className="text-accent hover:underline dark:text-blue-400">sign-in page</Link> first.</p>
            ) : (
              <div className="mb-4 overflow-x-auto scroll-thin">
                <table className="data-table">
                  <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Last sign-in</th><th></th></tr></thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.user_id}>
                        <td className="font-medium">{m.email ?? m.user_id}</td>
                        <td>
                          <form action={setMemberRoleAction.bind(null, m.user_id)} className="flex items-center gap-1.5">
                            <select name="role" defaultValue={m.role} title={ROLE_HINT[m.role]} className={fieldClass("sm")}>
                              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button className={buttonClass("subtle", "md")}>set</button>
                          </form>
                        </td>
                        <td className="text-body text-neutral-500">{new Date(m.created_at).toISOString().slice(0, 10)}</td>
                        <td className="text-body text-neutral-500">{m.last_sign_in_at ? new Date(m.last_sign_in_at).toISOString().slice(0, 10) : "never"}</td>
                        <td className="text-right">
                          <form action={removeMemberAction.bind(null, m.user_id)}>
                            <button className={buttonClass("subtle", "md")}>remove</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Invite a member</h3>
            <p className="mb-3 text-body text-neutral-500">
              You set a temporary password and share it out-of-band — nothing secret travels by URL or email.
              They change it from the sign-in page after first login.
            </p>
            <form action={inviteMemberAction} className="flex flex-wrap items-end gap-3">
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Email</span><input name="email" type="email" required className={`${input} w-56`} /></label>
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Temporary password (12+)</span><input name="password" type="text" required minLength={12} autoComplete="off" className={`${input} w-52`} /></label>
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Role</span>
                <select name="role" defaultValue="operator" className={input}>
                  {ROLES.map((r) => <option key={r} value={r} title={ROLE_HINT[r]}>{r}</option>)}
                </select>
              </label>
              <button className={buttonClass("primary", "md")}>Add member</button>
            </form>
          </>
        )}
      </Card>

      {/* ── Targeting: ICP + suppression (task #83) ── */}
      <BlockLabel>Targeting</BlockLabel>
      <Card className="mb-4">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Ideal customer profile</h3>
            <p className="mb-2 text-body text-neutral-500">
              Advisory, never blocking: fit chips render on named-overlap results and rankings. Unknown attributes
              count as unknown, not misfit.
            </p>
            <form action={saveIcpAction} className="space-y-2">
              <label className="block text-copy">
                <span className="mb-1 block text-body text-neutral-500">Industries (comma-separated)</span>
                <input name="industries" defaultValue={icp?.industries.join(", ") ?? ""} placeholder="Financial Services, Manufacturing" className={`${input} w-full`} />
              </label>
              <div className="flex gap-2">
                <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Employees min</span>
                  <input name="employeeMin" defaultValue={icp?.employeeMin ?? ""} inputMode="numeric" className={`${input} w-28`} />
                </label>
                <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Employees max</span>
                  <input name="employeeMax" defaultValue={icp?.employeeMax ?? ""} inputMode="numeric" className={`${input} w-28`} />
                </label>
              </div>
              <label className="block text-copy">
                <span className="mb-1 block text-body text-neutral-500">Countries (comma-separated)</span>
                <input name="geos" defaultValue={icp?.geos.join(", ") ?? ""} placeholder="germany, united states" className={`${input} w-full`} />
              </label>
              <label className="block text-copy">
                <span className="mb-1 block text-body text-neutral-500">Notes (who to ignore, in words)</span>
                <input name="icpNotes" defaultValue={icp?.notes ?? ""} placeholder="No agencies; no sub-50-seat shops" className={`${input} w-full`} />
              </label>
              <button className={buttonClass("primary", "md")}>Save profile</button>
            </form>
          </div>
          <div>
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Suppression list</h3>
            <p className="mb-2 text-body text-neutral-500">
              A hard guardrail: matching accounts are excluded from motion drafting and candidate surfaces entirely —
              competitors, existing customers, do-not-pursue.
            </p>
            <form action={addSuppressionAction} className="mb-3 flex flex-wrap items-end gap-2">
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Match by</span>
                <select name="kind" className={input}>
                  <option value="name">Company name</option>
                  <option value="domain">Domain</option>
                </select>
              </label>
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Value</span>
                <input name="value" required placeholder="Acme Corp or acme.com" className={`${input} w-44`} />
              </label>
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Reason</span>
                <input name="reason" placeholder="competitor" className={`${input} w-36`} />
              </label>
              <button className={buttonClass("destructive", "md")}>Suppress</button>
            </form>
            {suppressions.length === 0 ? (
              <p className="text-copy text-neutral-500">Nothing suppressed yet.</p>
            ) : (
              <ul className="space-y-1">
                {suppressions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-copy">
                    <span className="rounded-full bg-red-600/10 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-red-700 dark:text-red-400">{s.kind}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                    {s.reason && <span className="text-body text-neutral-400">{s.reason}</span>}
                    <form action={removeSuppressionAction.bind(null, s.id)}>
                      <button className={buttonClass("subtle", "md")}>remove</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* ── Partnerships ── */}
      <BlockLabel>Partnerships</BlockLabel>
      <Card className="mb-4">
        <p className="mb-4 text-body text-neutral-500">
          A partnership connects two tenants. You invite with a code bound to one of your partners; their owner
          redeems it on their own Admin page. Nothing crosses the boundary except lists you explicitly share —
          and those only appear after <em>their</em> owner accepts. Either side can revoke at any time.
        </p>

        {partnerships.length > 0 && (
          <div className="mb-4 overflow-x-auto scroll-thin">
            <table className="data-table">
              <thead><tr><th>Counterpart</th><th>Status</th><th>Your role</th><th>Shared out / in</th><th>Since</th><th></th></tr></thead>
              <tbody>
                {partnerships.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">
                      {p.otherOrgName ?? p.myLensName ?? "—"}
                      {p.inviteCode && (
                        <div className="mt-0.5 font-mono text-label text-neutral-500" title="Share this code with their owner">
                          code: {p.inviteCode}
                          {/* The same code as a link claims a FREE guest workspace (B+2) —
                              no PursuitOS account needed on their side. */}
                          <span className="block text-accent dark:text-blue-300">{joinBase}/join/{p.inviteCode}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={
                        p.status === "active" ? "text-positive dark:text-green-400"
                        : p.status === "invited" ? "text-amber-700 dark:text-amber-400"
                        : "text-neutral-400"
                      }>{p.status}</span>
                    </td>
                    <td className="text-body text-neutral-500">{p.role}</td>
                    <td className="tnum text-body text-neutral-500">{p.grantsOut} / {p.grantsIn}</td>
                    <td className="text-body text-neutral-500">{p.activatedAt ?? p.createdAt}</td>
                    <td className="text-right">
                      {p.status !== "revoked" && (
                        <form action={revokePartnershipAction.bind(null, p.id)}>
                          <button className={buttonClass("subtle", "md")}>revoke</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Invite a partner org</h3>
            <p className="mb-2 text-body text-neutral-500">
              Bound to one of your partners. The code works two ways: their owner redeems it on their Admin page, or
              — if they aren&apos;t on PursuitOS yet — the join link claims them a free guest workspace.
            </p>
            {isGuest ? (
              <p className="text-copy text-neutral-500">
                Guest workspaces can&apos;t invite partners — upgrading to a full workspace unlocks building your own
                network here.
              </p>
            ) : myPartners.length === 0 ? (
              <p className="text-copy text-neutral-500">No partners yet — add one first.</p>
            ) : (
              <form action={createInviteAction} className="flex flex-wrap items-end gap-2">
                <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Partner</span>
                  <select name="partnerId" className={input}>
                    {myPartners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <button className={buttonClass("primary", "md")}>Create invite</button>
              </form>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Redeem an invite</h3>
            <p className="mb-2 text-body text-neutral-500">Paste the code another org&apos;s owner gave you.</p>
            <form action={redeemInviteAction} className="flex flex-wrap items-end gap-2">
              <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Invite code</span>
                <input name="code" required placeholder="XXXXX-XXXXX-XXXXX-XXXXX" className={`${input} w-64 font-mono`} />
              </label>
              <button className={buttonClass("primary", "md")}>Redeem</button>
            </form>
          </div>
        </div>
      </Card>

      {/* ── Blind overlap (task #72) ── */}
      {ladders.length > 0 && (
        <>
          <BlockLabel>Blind overlap</BlockLabel>
          {ladders.map((ladder) => (
            <Card key={ladder.partnershipId} className="mb-4">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-copy font-semibold">{ladder.otherOrgName ?? "Partner org"}</span>
                <span className="text-label text-neutral-400">every step needs both owners · on the ledger</span>
              </div>
              <p className="mb-4 text-body text-neutral-500">
                Learn how much your books overlap <em>before</em> either side reveals an account. The
                overlap can only contain accounts already in your own book — a probe never shows you an
                account you don&apos;t know; it discloses which of yours the partner also has.
              </p>
              <div className="space-y-3">
                {OVERLAP_LEVELS.map((level, li) => {
                  const rung = ladder.rungs[level];
                  return (
                    <div
                      key={level}
                      className={`rounded-inner border p-3 ${
                        rung.state === "awaiting_you"
                          ? "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30"
                          : "border-neutral-200 dark:border-neutral-800"
                      } ${rung.state === "locked" ? "opacity-50" : ""}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tnum w-4 text-right text-body font-bold text-neutral-400">{li + 1}</span>
                        <span className="text-copy font-medium">{LEVEL_LABEL[level]}</span>
                        {rung.state === "approved" && (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-micro font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                            approved {rung.decidedAt}
                          </span>
                        )}
                        {rung.state === "requested_by_us" && (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-micro font-semibold text-neutral-500 dark:bg-neutral-800">
                            waiting on {ladder.otherOrgName ?? "them"} · {rung.requestedAt}
                          </span>
                        )}
                        {rung.state === "awaiting_you" && (
                          <span className="rounded-full bg-accent px-2 py-0.5 text-micro font-bold text-white">
                            awaiting your approval
                          </span>
                        )}
                        {rung.state === "declined" && (
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-micro font-semibold text-neutral-500 dark:bg-neutral-800">
                            declined {rung.decidedAt}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          {(rung.state === "available" || rung.state === "declined") && (
                            <form action={requestOverlapAction.bind(null, ladder.partnershipId, level)}>
                              <button className={buttonClass("primary", "sm")}>
                                {rung.state === "declined" ? "Request again" : "Request"}
                              </button>
                            </form>
                          )}
                          {rung.state === "awaiting_you" && (
                            <>
                              <form action={decideOverlapAction.bind(null, rung.probeId, true)}>
                                <button className={buttonClass("primary", "sm")}>
                                  Approve
                                </button>
                              </form>
                              <form action={decideOverlapAction.bind(null, rung.probeId, false)}>
                                <button className={buttonClass("primary", "sm")}>
                                  Decline
                                </button>
                              </form>
                            </>
                          )}
                          {rung.state === "locked" && (
                            <span className="text-label text-neutral-400">
                              unlocks after &ldquo;{LEVEL_LABEL[OVERLAP_LEVELS[li - 1]]}&rdquo; is approved
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="mt-1 pl-6 text-label text-neutral-400">{LEVEL_EXPLAIN[level]}</p>

                      {rung.state === "approved" && level === "counts" && (() => {
                        const r = rung.results as CountsResults;
                        return (
                          <div className="mt-2 flex items-baseline gap-3 pl-6">
                            <span className="pos-metric-fig">{r.overlap}</span>
                            <span className="text-body text-neutral-500">
                              overlapping accounts{myBookSize > 0 ? ` · ${Math.round((r.overlap / myBookSize) * 100)}% of your book` : ""}
                            </span>
                          </div>
                        );
                      })()}

                      {rung.state === "approved" && level === "bands" && orgId && (() => {
                        const r = rung.results as BandsResults;
                        const mine = r.categories[orgId] ?? {};
                        const theirs = Object.entries(r.categories).find(([k]) => k !== orgId)?.[1] ?? {};
                        const fmt = (m: Record<string, number>) =>
                          Object.entries(m).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${n} ${c.replace(/_/g, " ")}`).join(" · ") || "—";
                        return (
                          <div className="mt-2 space-y-1 pl-6 text-body">
                            <p><span className="font-medium text-neutral-700 dark:text-neutral-300">In your book:</span> <span className="text-neutral-500">{fmt(mine)}</span></p>
                            <p><span className="font-medium text-neutral-700 dark:text-neutral-300">In theirs:</span> <span className="text-neutral-500">{fmt(theirs)}</span></p>
                            <p className="flex flex-wrap gap-1.5 pt-1">
                              {r.industries.map((i) => (
                                <span key={i.industry} className="rounded-full bg-neutral-100 px-2 py-0.5 text-micro font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                                  {i.industry} · {i.count}
                                </span>
                              ))}
                            </p>
                          </div>
                        );
                      })()}

                      {rung.state === "approved" && level === "named" && orgId && (() => {
                        const r = rung.results as NamedResults;
                        return (
                          <div className="mt-2 max-h-56 overflow-y-auto pl-6 scroll-thin">
                            <table className="data-table">
                              <thead><tr><th>Account</th><th>Industry</th>{icp && <th>ICP</th>}<th>In your book as</th><th>In theirs as</th></tr></thead>
                              <tbody>
                                {r.accounts.map((a) => {
                                  const mine = a.cats[orgId] ?? [];
                                  const theirs = Object.entries(a.cats).find(([k]) => k !== orgId)?.[1] ?? [];
                                  const fit = fitById.get(a.company_id);
                                  return (
                                    <tr key={a.company_id}>
                                      <td className="font-medium">{a.name}</td>
                                      <td className="text-body text-neutral-500">{a.industry ?? "—"}</td>
                                      {icp && (
                                        <td>
                                          {fit === "fit" ? (
                                            <span className="rounded-full bg-emerald/12 px-2 py-0.5 text-micro font-bold text-emerald dark:text-emerald-300">fit</span>
                                          ) : fit === "off_profile" ? (
                                            <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-micro font-semibold text-neutral-500">off-profile</span>
                                          ) : (
                                            <span className="text-body text-neutral-400">—</span>
                                          )}
                                        </td>
                                      )}
                                      <td className="text-body text-neutral-500">{mine.map((c) => c.replace(/_/g, " ")).join(", ") || "—"}</td>
                                      <td className="text-body text-neutral-500">{theirs.map((c) => c.replace(/_/g, " ")).join(", ") || "—"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {r.truncated && <p className="mt-1 text-label text-neutral-400">showing the first 500 — the count above is the full overlap</p>}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </>
      )}

      {/* ── Agent access (task #76) ── */}
      <BlockLabel>Agent access</BlockLabel>
      <Card className="mb-4">
        <AgentKeys keys={keyRows} endpoint={mcpEndpoint} mint={mintApiKeyAction} revoke={revokeApiKeyAction} />
      </Card>

      {/* ── Bring your own model (slice C): their data, their AI contract ── */}
      <BlockLabel>Bring your own model</BlockLabel>
      <Card className="mb-4">
        {!byoAvailable ? (
          <p className="text-copy text-neutral-500">
            Not available in this environment — the server needs <code className="font-mono text-body">APP_ENCRYPTION_KEY</code> configured before tenant keys can be stored.
          </p>
        ) : (
          <>
            <p className="mb-3 text-copy text-neutral-600 dark:text-neutral-300">
              Supply your own Anthropic API key and every drafting agent (motions, campaigns, Ask) runs on <b>your</b> AI contract —
              your tenancy, your retention terms, your bill. The key is encrypted before storage, never shown again, and clearing it
              reverts to the platform key instantly.
            </p>
            {hasOwnKey ? (
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-body font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">own key active</span>
                <form action={clearOrgAiKeyAction}>
                  <button className={buttonClass("subtle", "md")}>clear — revert to platform key</button>
                </form>
              </div>
            ) : (
              <form action={setOrgAiKeyAction} className="flex flex-wrap gap-2">
                <input
                  name="apiKey"
                  type="password"
                  required
                  placeholder="sk-ant-…"
                  autoComplete="off"
                  className="w-[340px] rounded-inner border border-neutral-200 bg-transparent px-3 py-1.5 font-mono text-copy dark:border-neutral-800"
                />
                <button className={buttonClass("primary", "md")}>Save key</button>
              </form>
            )}
          </>
        )}
      </Card>

      {/* ── Shared lists ── */}
      <BlockLabel>Shared lists</BlockLabel>
      <Card className="mb-4">
        {grants.length === 0 ? (
          <p className="mb-4 text-copy text-neutral-500">Nothing shared in either direction yet.</p>
        ) : (
          <div className="mb-4 overflow-x-auto scroll-thin">
            <table className="data-table">
              <thead><tr><th>List</th><th>Direction</th><th>With</th><th>Fields</th><th>Status</th><th>Offered</th><th></th></tr></thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td className="font-medium">{g.listName}</td>
                    <td className="text-body text-neutral-500">{g.direction === "outgoing" ? "→ out" : "← in"}</td>
                    <td className="text-body">{g.otherOrgName ?? "—"}</td>
                    <td className="text-body text-neutral-500">{g.fields ? g.fields.join(", ") : "all"}</td>
                    <td>
                      <span className={
                        g.status === "accepted" ? "text-positive dark:text-green-400"
                        : g.status === "offered" ? "text-amber-700 dark:text-amber-400"
                        : "text-neutral-400"
                      }>{g.status}</span>
                      {g.stale && (
                        <span className="ml-1.5 rounded-inner bg-amber-100 px-1 py-0.5 text-micro font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="The source list changed since the copy last synced">
                          source changed
                        </span>
                      )}
                    </td>
                    <td className="text-body text-neutral-500">{g.createdAt}</td>
                    <td className="text-right">
                      {g.status === "accepted" && (
                        <form action={syncGrantAction.bind(null, g.id)} className="inline-block">
                          <button className={buttonClass("subtle", "md")} title="Re-copy the source list into the shared copy (adds, removals, attribute changes — still field-scoped)">sync</button>
                        </form>
                      )}
                      {g.direction === "incoming" && g.status === "offered" && (
                        <div className="flex justify-end gap-2">
                          <form action={acceptGrantAction.bind(null, g.id)}>
                            <button className={buttonClass("subtle", "md")}>accept</button>
                          </form>
                          <form action={declineGrantAction.bind(null, g.id)}>
                            <button className={buttonClass("subtle", "md")}>decline</button>
                          </form>
                        </div>
                      )}
                      {g.direction === "outgoing" && (g.status === "offered" || g.status === "accepted") && (
                        <form action={revokeGrantAction.bind(null, g.id)}>
                          <button className={buttonClass("subtle", "md")}>revoke</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Share a list</h3>
        {activePartnerships.length === 0 ? (
          <p className="text-copy text-neutral-500">Sharing needs an active partnership first.</p>
        ) : myLists.length === 0 ? (
          <p className="text-copy text-neutral-500">No approved lists of your own to share yet.</p>
        ) : (
          <form action={offerGrantAction} className="flex flex-wrap items-end gap-3">
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Partnership</span>
              <select name="partnershipId" className={input}>
                {activePartnerships.map((p) => <option key={p.id} value={p.id}>{p.otherOrgName ?? p.myLensName ?? p.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">List</span>
              <select name="populationId" className={input}>
                {myLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="text-copy"><span className="mb-1 block text-body text-neutral-500">Fields (comma-separated; blank = all)</span>
              <input name="fields" placeholder="territory, vertical" className={`${input} w-56`} />
            </label>
            <button className={buttonClass("primary", "md")}>Offer</button>
          </form>
        )}
        <p className="mt-3 border-t border-neutral-100 pt-2 text-label text-neutral-400 dark:border-neutral-800">
          Field scoping limits which member attributes travel with the list. Their copy materializes only on accept;
          &quot;source changed&quot; flags a copy that has drifted from the list behind it, and sync re-copies it
          (still field-scoped). Revoking flips the copy off on their side immediately.
        </p>
      </Card>

      {/* ── Privacy: GDPR data-subject rights (RISK-2) ── */}
      <BlockLabel>Privacy &amp; data-subject rights</BlockLabel>
      <Card className="mb-4">
        <p className="mb-4 max-w-[92ch] text-copy text-neutral-600 dark:text-neutral-300">
          Serve a person&apos;s GDPR request against the personal data this workspace holds about them — CRM
          contacts, partner/vendor sellers, email correspondence, and meeting notes. Scoped to your organization;
          you can only reach subjects in your own tenant. Platform-account requests (a member&apos;s own login) are
          handled by removing the member above.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Access & portability (Art. 15/20) */}
          <div>
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Export a copy · Art. 15/20</h3>
            <p className="mb-2 text-body text-neutral-500">
              Download everything held about the subject as portable JSON. Read-only — nothing changes.
            </p>
            <form method="get" action="/api/privacy/export" className="flex flex-wrap items-end gap-2">
              <label className="text-copy">
                <span className="mb-1 block text-body text-neutral-500">Subject email</span>
                <input name="email" type="email" required placeholder="person@company.com" className={`${input} w-64`} />
              </label>
              <Button type="submit">Export JSON</Button>
            </form>
          </div>

          {/* Erasure (Art. 17) */}
          <div>
            <h3 className="mb-1 text-body font-semibold uppercase tracking-wide text-neutral-500">Erase · Art. 17</h3>
            <p className="mb-2 text-body text-neutral-500">
              Preview first to see the count. Erasure anonymizes in place (contacts and sellers keep their business
              record; identifiers are removed) and is <b>irreversible</b>. Type <code className="font-mono">ERASE</code> to confirm.
            </p>
            <form className="flex flex-wrap items-end gap-2">
              <label className="text-copy">
                <span className="mb-1 block text-body text-neutral-500">Subject email</span>
                <input name="email" type="email" required placeholder="person@company.com" className={`${input} w-64`} />
              </label>
              <label className="text-copy">
                <span className="mb-1 block text-body text-neutral-500">Confirm</span>
                <input name="confirm" placeholder="ERASE" autoComplete="off" className={`${input} w-28`} />
              </label>
              <Button variant="ghost" formAction={previewDataSubjectAction}>Preview</Button>
              <Button variant="danger" formAction={eraseDataSubjectAction}>Erase permanently</Button>
            </form>
          </div>
        </div>
        <p className="mt-3 border-t border-neutral-100 pt-2 text-label text-neutral-400 dark:border-neutral-800">
          Every erasure lands in the audit log below as <code className="font-mono">privacy.subject_erased</code> with a
          one-way hash of the email (never the address itself) and the per-table counts.
        </p>
      </Card>

      {/* ── Audit log ── */}
      <BlockLabel>Audit log</BlockLabel>
      <Card className="mb-6">
        {ledger.length === 0 ? (
          <p className="text-copy text-neutral-500">No entries yet — membership and cross-tenant events land here.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="data-table">
              <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Detail</th></tr></thead>
              <tbody>
                {ledger.map((e, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap text-body text-neutral-500">{e.createdAt}</td>
                    <td className="text-body">{e.actor}</td>
                    <td className="text-body font-medium">{e.event}</td>
                    <td className="max-w-md truncate font-mono text-label text-neutral-500" title={JSON.stringify(e.detail)}>
                      {JSON.stringify(e.detail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 border-t border-neutral-100 pt-2 text-label text-neutral-400 dark:border-neutral-800">
          Your organization&apos;s own ledger — every membership change and every cross-tenant event (invites, handshakes,
          shares, revocations) with who did it and when. The counterpart org gets its own mirror entries.
        </p>
      </Card>

      {/* ── AI operations ── */}
      <BlockLabel>AI operations</BlockLabel>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Bento label="agent runs" value={totalRuns} />
        <Bento label="AI spend" value={formatCost(totalCost)} />
        <Bento label="research queue" value={Number(qd.research_pending)} subs={[`${qd.research_running} running`]} />
        <Bento label="evidence to review" value={Number(qd.review_pending)} href="/review" />
        <Bento label="touches scheduled" value={Number(qd.touches_scheduled)} href="/upcoming" />
        <Bento label="worker" value={workerStatus === "healthy" ? "✓" : workerStatus === "not configured" ? "—" : "✗"} subs={[workerStatus]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-body font-semibold uppercase tracking-wide text-neutral-500">Agent workflows · spend, latency, human overrides</h3>
          {agents.length === 0 ? (
            <p className="text-copy text-neutral-500">No agent runs recorded yet.</p>
          ) : (
            <table className="w-full text-copy">
              <thead><tr className="text-left text-micro uppercase tracking-wide text-neutral-400"><th className="pb-1 font-medium">Workflow</th><th className="pb-1 text-right font-medium">Runs</th><th className="pb-1 text-right font-medium">Cost</th><th className="pb-1 text-right font-medium">Avg ms</th><th className="pb-1 text-right font-medium">Overridden</th></tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.workflow}>
                    <td className="py-0.5">{a.workflow.replace(/_/g, " ")}</td>
                    <td className="tnum py-0.5 text-right">{a.n}</td>
                    <td className="tnum py-0.5 text-right">{formatCost(a.cost == null ? null : Number(a.cost))}</td>
                    <td className="tnum py-0.5 text-right">{a.ms ?? "—"}</td>
                    <td className="tnum py-0.5 text-right text-neutral-500">{a.overridden}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 border-t border-neutral-100 pt-2 text-label text-neutral-400 dark:border-neutral-800">
            Override rate is the health metric: rising human edits/rejections on a workflow = its prompts or grounding are drifting.
          </p>
        </Card>

        <Card>
          <h3 className="mb-3 text-body font-semibold uppercase tracking-wide text-neutral-500">Provider failures · latest</h3>
          {providerErrors.length === 0 ? (
            <p className="text-copy text-neutral-500">No provider failures recorded. Full registry on <Link href="/provider-health" className="text-accent hover:underline dark:text-blue-400">Provider health</Link>.</p>
          ) : (
            <ul className="space-y-1.5">
              {providerErrors.map((e, i) => (
                <li key={i} className="text-body">
                  <span className="font-medium">{e.provider_id}</span>
                  <span className="text-neutral-400"> · {e.status}{e.finished_at ? ` · ${new Date(e.finished_at).toISOString().slice(0, 10)}` : ""}</span>
                  {e.error && <div className="truncate text-neutral-500" title={e.error}>{e.error.slice(0, 120)}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-neutral-100 pt-2 text-label text-neutral-400 dark:border-neutral-800">
            Deeper cuts live on <Link href="/provider-health" className="underline">Provider health</Link> and <Link href="/insights" className="underline">Insights</Link>; error tracking &amp; alerting (Sentry-class) is tracked on the security roadmap.
          </p>
        </Card>
      </div>

      <Card className="mt-4">
        <h3 className="mb-3 text-body font-semibold uppercase tracking-wide text-neutral-500">Recent agent runs</h3>
        {recentRuns.length === 0 ? (
          <p className="text-copy text-neutral-500">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="data-table">
              <thead><tr><th>When</th><th>Workflow</th><th>Model</th><th className="text-right">Cost</th><th className="text-right">Latency</th><th>Human decision</th></tr></thead>
              <tbody>
                {recentRuns.map((r, i) => (
                  <tr key={i}>
                    <td className="text-body text-neutral-500">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td>{r.workflow.replace(/_/g, " ")}</td>
                    <td className="text-body text-neutral-500">{r.model}</td>
                    <td className="tnum text-right">{formatCost(r.cost_usd == null ? null : Number(r.cost_usd))}</td>
                    <td className="tnum text-right">{r.latency_ms == null ? "—" : `${r.latency_ms}ms`}</td>
                    <td className="text-body">{r.human_decision ?? <span className="text-neutral-400">pending</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
