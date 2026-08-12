import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/**
 * Identity (task #64, slice 1). Supabase Auth carries user sessions; the data
 * path stays on the direct pg pool for now. Everything here no-ops cleanly
 * when the NEXT_PUBLIC_SUPABASE_* env vars are absent, so environments without
 * identity configured (and the Basic-Auth demo) behave exactly as before.
 */

export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Cookie-bound client for server components / actions (anon key + session). */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => {
          try {
            for (const { name, value, options } of all) cookieStore.set(name, value, options);
          } catch {
            /* called from a Server Component render — middleware refreshes instead */
          }
        },
      },
    },
  );
}

/** Service-role client — server-only, used solely for user administration. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
