import { getPool } from "@/db/client";
import { Card } from "@/components/ui";
import { authConfigured, supabaseServer } from "@/lib/auth/supabase";
import { createOwnerAction, signInAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Sign-in (identity slice of #64). Until identity is configured this page just
 * says so; once the owner exists, the create form disappears for good.
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

  const input = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <main className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-1 text-xl font-bold tracking-tight">Sign in</h1>
      <p className="mb-5 text-sm text-neutral-500">PursuitOS — operator access.</p>

      {sp.error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {sp.error}
        </div>
      )}

      {!configured ? (
        <Card>
          <p className="text-sm text-neutral-500">
            Identity isn&apos;t configured on this deployment (set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Basic Auth continues to gate the app where enabled.
          </p>
        </Card>
      ) : signedInAs ? (
        <Card>
          <p className="mb-3 text-sm">
            Signed in as <span className="font-medium">{signedInAs}</span>.
          </p>
          <div className="flex gap-3">
            <a href="/" className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700">Open the app</a>
            <form action={signOutAction}>
              <button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">
                Sign out
              </button>
            </form>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <form action={signInAction} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Email</span>
                <input name="email" type="email" required autoComplete="username" className={input} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Password</span>
                <input name="password" type="password" required autoComplete="current-password" className={input} />
              </label>
              <button className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
                Sign in
              </button>
            </form>
          </Card>

          {!hasMembers && (
            <Card>
              <h2 className="mb-1 text-sm font-semibold">First run — create the owner account</h2>
              <p className="mb-3 text-xs text-neutral-500">
                Available only until the first owner exists; this form then disappears permanently.
              </p>
              <form action={createOwnerAction} className="space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-neutral-500">Email</span>
                  <input name="email" type="email" required autoComplete="username" className={input} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-neutral-500">Password (12+ characters)</span>
                  <input name="password" type="password" required minLength={12} autoComplete="new-password" className={input} />
                </label>
                <button className="w-full rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800">
                  Create owner &amp; sign in
                </button>
              </form>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
