import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Access gate, in transition (task #64 slice 1). Two credentials are accepted,
 * checked in order:
 *
 *   1. HTTP Basic Auth (BASIC_AUTH_USER/PASS) — the original single-operator
 *      gate; unchanged, so demo deployments behave exactly as before.
 *   2. A Supabase Auth session — real identity. When only identity is
 *      configured, unauthenticated browsers are redirected to /login.
 *
 * Nothing configured (local dev) → open, as always. Basic Auth retires once
 * identity + roles are fully rolled out.
 */

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function basicAuthValid(req: NextRequest): Promise<boolean> {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return false;
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    // Digest comparison: no byte-by-byte timing signal.
    const [uHash, pHash, userHash, passHash] = await Promise.all([digest(u), digest(p), digest(user), digest(pass)]);
    return uHash === userHash && pHash === passHash;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const basicConfigured = Boolean(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const identityConfigured = Boolean(supabaseUrl && supabaseAnon);

  if (!basicConfigured && !identityConfigured) return NextResponse.next(); // local dev

  // 1. Basic Auth — the demo path, exactly as before.
  if (await basicAuthValid(req)) return NextResponse.next();

  // 2. Supabase session — canonical @supabase/ssr pattern (also refreshes
  //    expiring tokens; the refreshed cookies ride out on the response).
  if (identityConfigured) {
    let res = NextResponse.next({ request: req });
    const supabase = createServerClient(supabaseUrl!, supabaseAnon!, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (all) => {
          for (const { name, value } of all) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of all) res.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (data.user) return res;

    // The sign-in surface itself must stay reachable.
    if (req.nextUrl.pathname.startsWith("/login")) return res;
  }

  // 3. Unauthenticated: Basic-Auth deployments keep the browser prompt;
  //    identity-only deployments go to the sign-in page.
  if (basicConfigured) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="PursuitOS"' },
    });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Webhooks authenticate with provider signatures (svix); the research trigger
  // authenticates with its own bearer secret — neither uses Basic Auth.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/research).*)"],
};
