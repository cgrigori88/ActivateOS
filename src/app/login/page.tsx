import { getPool } from "@/db/client";
import { HeroMesh } from "@/components/hero-mesh";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { createOwnerAction, signInAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Sign-in (identity slice of #64). Until identity is configured this page just
 * says so; once the owner exists, the create form disappears for good.
 *
 * Laid out as a split gate: the form on the left where reading starts, the
 * landing page's wireframe mark on the right so the product is recognisable
 * before anyone is inside it. The panel collapses away under lg — on a phone a
 * decorative half would push the form below the fold.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const configured = authConfigured();

  let hasMembers = true;
  let signedInAs: string | null = null;
  if (configured) {
    const { rows } = await getPool().query<{ n: string }>(`select count(*)::text as n from org_members`);
    hasMembers = Number(rows[0].n) > 0;
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    signedInAs = data.user?.email ?? null;
  }

  const field =
    "w-full rounded-input border border-neutral-300/80 bg-white/70 px-3.5 py-2.5 text-[15px] backdrop-blur transition-colors duration-[140ms] placeholder:text-neutral-400 hover:border-neutral-400 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 dark:border-white/15 dark:bg-white/[0.06] dark:hover:border-white/30";
  const label = "mb-1.5 block text-[12.5px] font-semibold text-neutral-600 dark:text-neutral-300";
  const primary =
    "inline-flex w-full min-h-[44px] items-center justify-center rounded-full bg-accent px-5 text-[14.5px] font-bold text-white transition-colors duration-[140ms] hover:bg-accent-strong";

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ---- Form ---------------------------------------------------------- */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[420px]">
          <a href="/" className="mb-10 inline-flex items-center gap-2.5">
            <span className="text-accent dark:text-blue-400">
              <svg viewBox="0 0 48 48" className="h-7 w-7" fill="currentColor" fillRule="nonzero" aria-hidden>
                <path d="M4 24 A20 20 0 1 1 44 24 A20 20 0 1 1 4 24 Z M29 26 A10 10 0 1 0 9 26 A10 10 0 1 0 29 26 Z M39 17 A4 4 0 1 0 31 17 A4 4 0 1 0 39 17 Z" />
              </svg>
            </span>
            <span className="text-[19px] font-extrabold tracking-[-0.03em]">PursuitOS</span>
          </a>

          {sp.error && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2.5 rounded-input bg-rose/12 px-4 py-3 text-[13.5px] font-medium text-rose"
            >
              <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.5M8 11v.01" />
              </svg>
              <span>{sp.error}</span>
            </div>
          )}

          {!configured ? (
            <>
              <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">Identity isn&apos;t configured</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                Set <code className="rounded bg-neutral-900/[0.06] px-1.5 py-0.5 font-mono text-[13px] dark:bg-white/10">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                <code className="rounded bg-neutral-900/[0.06] px-1.5 py-0.5 font-mono text-[13px] dark:bg-white/10">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> on this
                deployment. Basic Auth continues to gate the app where enabled.
              </p>
            </>
          ) : signedInAs ? (
            <>
              <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">You&apos;re signed in</h1>
              <p className="mt-3 text-[15px] text-neutral-500 dark:text-neutral-400">
                as <span className="font-semibold text-neutral-900 dark:text-neutral-100">{signedInAs}</span>
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="/" className={primary + " w-auto"}>Open the app</a>
                <form action={signOutAction}>
                  <button className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-neutral-300/80 px-5 text-[14.5px] font-semibold transition-colors duration-[140ms] hover:bg-neutral-900/[0.04] dark:border-white/15 dark:hover:bg-white/10">
                    Sign out
                  </button>
                </form>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">Sign in</h1>
              <p className="mt-3 text-[15px] text-neutral-500 dark:text-neutral-400">
                Operator access to the partner revenue graph.
              </p>

              <form action={signInAction} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="email" className={label}>Email</label>
                  <input id="email" name="email" type="email" required autoComplete="username" placeholder="you@company.com" className={field} />
                </div>
                <div>
                  <label htmlFor="password" className={label}>Password</label>
                  <input id="password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••••••" className={field} />
                </div>
                <button className={primary}>Sign in</button>
              </form>

              {!hasMembers && (
                <>
                  <div className="my-8 flex items-center gap-4">
                    <span className="h-px flex-1 bg-neutral-900/10 dark:bg-white/10" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400">First run</span>
                    <span className="h-px flex-1 bg-neutral-900/10 dark:bg-white/10" />
                  </div>

                  <h2 className="text-[17px] font-bold tracking-[-0.02em]">Create the owner account</h2>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                    Available only until the first owner exists. This form then disappears permanently.
                  </p>

                  <form action={createOwnerAction} className="mt-5 space-y-5">
                    <div>
                      <label htmlFor="owner-email" className={label}>Email</label>
                      <input id="owner-email" name="email" type="email" required autoComplete="username" placeholder="you@company.com" className={field} />
                    </div>
                    <div>
                      <label htmlFor="owner-password" className={label}>Password</label>
                      <input id="owner-password" name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="At least 12 characters" className={field} />
                      <p className="mt-1.5 text-[12.5px] text-neutral-500 dark:text-neutral-400">12 characters minimum.</p>
                    </div>
                    <button className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-emerald px-5 text-[14.5px] font-bold text-white transition-colors duration-[140ms] hover:bg-[#047857]">
                      Create owner &amp; sign in
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- Visual -------------------------------------------------------- */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-3 overflow-hidden rounded-panel bg-[#0b1220]">
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_35%,#12224a_0%,#070d1c_58%,#04070f_100%)]" />
          <HeroMesh className="absolute inset-0 h-full w-full" />
          {/* The field resolves into the ground rather than ending on an edge. */}
          <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-[#04070f] via-[#04070f]/70 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-300/70">
              Partner-led revenue
            </p>
            <p className="mt-3 max-w-[22ch] text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">
              Know where revenue moves next.
            </p>
            <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-white/55">
              PursuitOS scores the intersection of customer, product, partner, seller and timing,
              then assembles the motion to pursue it.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
