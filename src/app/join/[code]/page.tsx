import { getPool } from "@/db/client";
import { HeroMesh } from "@/components/hero-mesh";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { inviteInfo } from "@/lib/partnerships/guest";
import { claimGuestSeatAction, claimWorkspaceAction, connectExistingAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Guest-seat landing (B+2, task #81) — the ONLY public page in the app. The
 * invite code in the URL is the capability: a live code shows who is inviting
 * and claims a free guest workspace; anything else shows a dead-link message
 * that names nothing. Styled after the /login split gate; no shell chrome
 * (this visitor isn't "inside" anything yet).
 */

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const pool = getPool();
  const invite = await inviteInfo(pool, code);
  const configured = authConfigured();

  // Signed-in state (identity mode): resolved via membership directly — the
  // sole-org fallback is for Basic-Auth deployments, never for a public page.
  let signedInAs: string | null = null;
  let memberOrgName: string | null = null;
  if (configured) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    signedInAs = data.user?.email ?? null;
    if (data.user) {
      const { rows } = await pool.query<{ name: string }>(
        `select o.name from org_members m join organizations o on o.id = m.org_id
         where m.user_id = $1 order by m.created_at asc limit 1`,
        [data.user.id],
      );
      memberOrgName = rows[0]?.name ?? null;
    }
  }

  const field =
    "w-full rounded-input border border-neutral-300/80 bg-white/70 px-3.5 py-2.5 text-[15px] backdrop-blur transition-colors duration-[140ms] placeholder:text-neutral-400 hover:border-neutral-400 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 dark:border-white/15 dark:bg-white/[0.06] dark:hover:border-white/30";
  const label = "mb-1.5 block text-[12.5px] font-semibold text-neutral-600 dark:text-neutral-300";
  const primary =
    "inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-accent px-5 text-[14.5px] font-bold text-white transition-colors duration-[140ms] hover:bg-accent-strong";

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[440px]">
          <a href="/" className="mb-10 inline-flex items-center gap-2.5">
            <span className="text-accent dark:text-blue-400">
              <svg viewBox="0 0 48 48" className="h-7 w-7" fill="currentColor" fillRule="nonzero" aria-hidden>
                <path d="M4 24 A20 20 0 1 1 44 24 A20 20 0 1 1 4 24 Z M29 26 A10 10 0 1 0 9 26 A10 10 0 1 0 29 26 Z M39 17 A4 4 0 1 0 31 17 A4 4 0 1 0 39 17 Z" />
              </svg>
            </span>
            <span className="text-[19px] font-extrabold tracking-[-0.03em]">PursuitOS</span>
          </a>

          {sp.error && (
            <div role="alert" className="mb-6 rounded-input bg-rose/12 px-4 py-3 text-[13.5px] font-medium text-rose">
              {sp.error}
            </div>
          )}

          {!invite ? (
            <>
              <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">
                This invite link isn&apos;t valid anymore
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                It may have been redeemed already, or revoked by the organization that issued it. Ask your partner
                contact for a fresh link.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">
                {invite.inviterOrgName} invited you to co-sell
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                This seat is free. You get your own private workspace: bring your book, learn how much it overlaps
                with theirs — one consented rung at a time — open joint pursuit rooms, and read the same settlement
                ledger they do. Nothing of yours is visible to them until you approve it, and either side can sever
                at any time.
              </p>

              {/* ── Claim / connect, by who's asking ── */}
              {configured && !signedInAs && (
                <form action={claimGuestSeatAction.bind(null, code)} className="mt-8 space-y-4">
                  <div>
                    <label className={label} htmlFor="workspace">Your workspace name</label>
                    <input id="workspace" name="workspace" required placeholder="Your company's name" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor="email">Work email</label>
                    <input id="email" name="email" type="email" required placeholder="you@company.com" className={field} />
                  </div>
                  <div>
                    <label className={label} htmlFor="password">Password (12+ characters)</label>
                    <input id="password" name="password" type="password" required minLength={12} className={field} />
                  </div>
                  <button className={primary}>Claim your free workspace</button>
                  <p className="text-[12px] text-neutral-400">
                    Already have a PursuitOS account?{" "}
                    <a href="/login" className="text-accent hover:underline dark:text-blue-300">Sign in</a> and reopen
                    this link.
                  </p>
                </form>
              )}

              {configured && signedInAs && !memberOrgName && (
                <form action={claimWorkspaceAction.bind(null, code)} className="mt-8 space-y-4">
                  <p className="text-[13.5px] text-neutral-500">
                    Signed in as <span className="font-semibold">{signedInAs}</span> — name your workspace to claim
                    the seat.
                  </p>
                  <div>
                    <label className={label} htmlFor="workspace">Your workspace name</label>
                    <input id="workspace" name="workspace" required placeholder="Your company's name" className={field} />
                  </div>
                  <button className={primary}>Claim your free workspace</button>
                </form>
              )}

              {((configured && signedInAs && memberOrgName) || !configured) && (
                <form action={connectExistingAction.bind(null, code)} className="mt-8 space-y-4">
                  <p className="text-[13.5px] text-neutral-500">
                    {configured
                      ? <>Signed in as <span className="font-semibold">{signedInAs}</span> with workspace{" "}
                          <span className="font-semibold">{memberOrgName}</span>.</>
                      : "This deployment has a workspace already."}{" "}
                    Connecting makes the partnership active for both sides.
                  </p>
                  <button className={primary}>Connect {configured ? memberOrgName : "this workspace"} to {invite.inviterOrgName}</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- Wireframe panel, same identity as the sign-in gate ---- */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-3 overflow-hidden rounded-panel bg-[#0b1220]">
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_35%,#12224a_0%,#070d1c_58%,#04070f_100%)]" />
          <HeroMesh className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-[#04070f] via-[#04070f]/70 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-300/70">Co-sell, consented</p>
            <p className="mt-3 max-w-[22ch] text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">
              The space between companies.
            </p>
            <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-white/55">
              Overlap discovered blind, one rung at a time. Joint rooms both sides see identically. A settlement
              ledger neither side has to argue with.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
