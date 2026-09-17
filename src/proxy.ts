import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PRINCIPAL_HEADER, type Principal } from "@/lib/auth/principal";
import { clientIp, rateLimited } from "@/lib/security/rate-limit";
import { siteMode, type SiteMode } from "@/lib/env/environment";

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
 *
 * This is also where the Content-Security-Policy is born (#65): a fresh nonce
 * per request rides in on the request headers — Next reads it from there and
 * stamps it onto every inline script it emits, and the root layout stamps it
 * onto the theme-boot script. `strict-dynamic` lets the nonce'd bootstrap
 * loader pull in Next's chunks without enumerating them. Production only:
 * dev mode needs eval for react-refresh, and a dev-shaped CSP would just rot.
 */

function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw);
}

function cspFor(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind/Next inject <style> at runtime; styles can't exfiltrate, so
    // 'unsafe-inline' here is the accepted trade the industry makes.
    "style-src 'self' 'unsafe-inline'",
    // https: keeps branded-email previews (sandboxed srcdoc iframes inherit
    // this CSP) able to show remote logos/images.
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Is this path the deliberately-public guest-seat landing?
 *
 * SEGMENT-EXACT ON PURPOSE. The test was `pathname.startsWith("/join")`, which also matched
 * `/joint` — the authenticated joint-pursuit room — so an unauthenticated caller reached it and it
 * rendered: with no session, `sessionOrgId()` resolves `resolve_user_org(null)`, which falls back to
 * the OLDEST organization, and the room then rendered that org's partner names, joint pursuits,
 * settlement panel and row ids. Writes were never exposed (every `/joint` server action runs
 * `requireWrite` inside `withTenant`, and with no user there is no role), but the read was.
 *
 * A path belongs to the family only if it IS `/join` or lies strictly under `/join/`. Anything that
 * merely begins with those five characters — `/joint`, `/joint/<id>`, `/joinery` — stays gated.
 * Deployment Protection is defense in depth and is NOT the authorization boundary; this is.
 */
export function isGuestSeatPath(pathname: string): boolean {
  return pathname === "/join" || pathname.startsWith("/join/");
}

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

/**
 * Public-site mode (topology §2A / §4).
 *
 * When PURSUITOS_ENV=public this deployment is the marketing site and nothing
 * else. The application routes are not merely unlinked — they are unreachable,
 * because "unlinked" is not a security boundary. `/` serves the landing page and
 * every other path 404s before it can touch a database.
 *
 * This is why the public site can safely run from the same repository as the
 * app: the separation is enforced here, at the edge, not by remembering to
 * deploy a different branch.
 */
function publicSiteResponse(req: NextRequest, nonce: string, csp: string | null): NextResponse | null {
  let mode: SiteMode;
  try {
    mode = siteMode();
  } catch (e) {
    // A typo'd PURSUITOS_ENV must not silently resolve to "serve the app".
    // Refusing every request is the safe failure: loud, immediate, and it
    // cannot leak an environment's data under another environment's name.
    return new NextResponse((e as Error).message, { status: 500 });
  }
  if (mode !== "public") return null;

  const { pathname } = req.nextUrl;

  // Next's own asset routes must pass through or the page has no CSS or fonts.
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname === "/icon.svg") {
    return NextResponse.next();
  }

  const headersFor = (res: NextResponse) => {
    if (csp) res.headers.set("content-security-policy", csp);
    // The public site is the one surface that SHOULD be indexed; the demo and
    // app are not, and neither inherits this because neither runs in this mode.
    res.headers.set("x-robots-tag", "index, follow");
    return res;
  };

  if (pathname === "/" || pathname === "/landing") {
    const url = req.nextUrl.clone();
    url.pathname = "/landing";
    const fwd = new Headers(req.headers);
    fwd.delete("x-nonce"); // never trust a client-supplied nonce
    if (csp) {
      fwd.set("content-security-policy", csp); // where Next reads the nonce
      fwd.set("x-nonce", nonce);               // where the root layout reads it
    }
    // Marks the surface so the root layout renders WITHOUT the application
    // shell — a marketing page must not carry the product's navigation rail.
    // set() replaces any inbound value, so a client cannot influence it here.
    fwd.set("x-pursuitos-surface", "landing");
    return headersFor(NextResponse.rewrite(url, { request: { headers: fwd } }));
  }

  return headersFor(new NextResponse("Not found", { status: 404 }));
}

export async function proxy(req: NextRequest) {
  const basicConfigured = Boolean(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const identityConfigured = Boolean(supabaseUrl && supabaseAnon);

  // CSP plumbing: the nonce travels on the REQUEST (that's where Next picks it
  // up for its own inline scripts) and the policy lands on the RESPONSE.
  const nonce = makeNonce();
  const csp = process.env.NODE_ENV === "production" ? cspFor(nonce) : null;

  // Public site: decided before any auth or database consideration, because in
  // that mode there is no tenant to authenticate and no database to reach.
  const publicResponse = publicSiteResponse(req, nonce, csp);
  if (publicResponse) return publicResponse;

  // Ecosystem scope (scale-disclosure §1): a shareable `?scope=` link mirrors into the persistent
  // `pos:scope` cookie so the whole shell (selector + chip) reflects it on this same render and
  // survives subsequent plain navigations. This is presentation persistence only — every room
  // re-authorizes the scope server-side against the RLS-scoped set, so it can never widen visibility.
  const rawScope = req.nextUrl.searchParams.get("scope");
  const scopeToken = rawScope && /^[a-z]+(:[A-Za-z0-9 _.\-]{1,128})?$/.test(rawScope) ? rawScope : null;

  /**
   * Let the request through, stating WHICH principal the gate established — `null` for the routes
   * that are allowed through without one (the guest seat and the sign-in surface). Server rendering
   * reads this to decide whether it may resolve a tenant at all; see src/lib/auth/principal.ts.
   */
  const pass = (principal: Principal | null = null) => {
    if (scopeToken && req.cookies.get("pos:scope")?.value !== scopeToken) {
      req.cookies.set("pos:scope", scopeToken); // same-render: server components read the new cookie
    }
    // Rebuild from req.headers so cookie refreshes (below) are carried too.
    const fwd = new Headers(req.headers);
    fwd.delete("x-nonce"); // never trust a client-supplied nonce
    // Same reasoning as the nonce: the root layout treats this header as proof
    // that the proxy classified the request as the public marketing surface, and
    // renders without the application shell when it sees it. A client that could
    // set it could strip the navigation off any authenticated page, so it is
    // cleared on every request the gate lets through.
    fwd.delete("x-pursuitos-surface");
    // Same discipline, and it carries more weight here: a client that could set this would award
    // itself a principal and with it a tenant read. Deleted first, ALWAYS, then set only from what
    // this function was told by the branch that actually checked a credential.
    fwd.delete(PRINCIPAL_HEADER);
    if (principal) fwd.set(PRINCIPAL_HEADER, principal);
    if (csp) {
      fwd.set("content-security-policy", csp); // where Next reads the nonce
      fwd.set("x-nonce", nonce); // where the root layout reads it
    }
    const res = NextResponse.next({ request: { headers: fwd } });
    if (csp) res.headers.set("content-security-policy", csp);
    // Only the public site should be indexed. The app and the demo are gated by
    // authentication — this header is hygiene, not access control, and it is
    // stated here rather than in a robots.txt precisely so nobody mistakes it
    // for a gate: a crawler that ignores it still meets the sign-in redirect.
    res.headers.set("x-robots-tag", "noindex, nofollow");
    // RECIPIENT-SPECIFIC PROJECTIONS VARY BY CREDENTIAL, AND THE CREDENTIAL IS A COOKIE.
    // `Vary: Cookie` is declared in next.config.mjs, but a dynamic App Router response carries the
    // framework's own Vary (the RSC negotiation list) and the configured value never reaches the
    // wire — measured on the deployed Preview: 0 of 7 authenticated rooms carried it. A header that
    // is configured but not delivered is stored policy that nothing enforces, which is the whole
    // defect class P6-IG exists to close. APPENDED here, on the response the gate returns, where it
    // survives — the same placement as x-robots-tag above.
    //
    // `no-store` remains the control that actually matters (nothing may be stored at all, so there
    // is nothing for a shared cache to mis-serve); this is defense in depth beside it.
    res.headers.append("vary", "Cookie");
    if (scopeToken) res.cookies.set("pos:scope", scopeToken, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    return res;
  };

  if (!basicConfigured && !identityConfigured) return pass("open"); // local dev

  // Guest-seat landing (B+2): /join/<code> is deliberately public — the
  // ~93-bit invite code in the URL is the credential, its actions are
  // rate-limited, and a dead code reveals nothing. Everything else stays gated.
  //
  // NO PRINCIPAL. The invite code authorizes the guest-seat flow and nothing else, so rendering
  // gets no tenant: the code is a capability for one partnership, never a seat in the organization
  // that issued it. What the invite itself discloses still comes from `inviteInfo`, which reads it.
  if (isGuestSeatPath(req.nextUrl.pathname)) return pass();

  // 1. Basic Auth — the demo path, exactly as before.
  if (await basicAuthValid(req)) return pass("basic");

  // A PRESENTED-but-wrong Basic credential is a guess — throttle guessing.
  // (No header at all is just an unauthenticated browser; that's not counted,
  // so the 401 prompt and normal sign-ins are never rate-limited.)
  if (basicConfigured && req.headers.get("authorization")?.startsWith("Basic ")) {
    if (rateLimited(`basic:${clientIp(req.headers)}`, 20, 10 * 60_000)) {
      return new NextResponse("Too many attempts — try again later.", { status: 429 });
    }
  }

  // 2. Supabase session — canonical @supabase/ssr pattern (also refreshes
  //    expiring tokens; the refreshed cookies ride out on the response).
  if (identityConfigured) {
    // The refresh is collected rather than turned straight into a response, because the principal
    // is not known until getUser() answers and `pass()` must be called once, with it. Refreshed
    // cookies are written onto the REQUEST here (so the forwarded render sees them) and onto the
    // RESPONSE below (so the browser keeps them) — the same two placements as before.
    const refreshed: { name: string; value: string; options?: Record<string, unknown> }[] = [];
    const supabase = createServerClient(supabaseUrl!, supabaseAnon!, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (all) => {
          for (const c of all) {
            req.cookies.set(c.name, c.value);
            refreshed.push(c);
          }
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    // The sign-in surface itself must stay reachable — and it is reached WITHOUT a principal, which
    // is the whole point: /login is a pre-authentication surface and must render tenant-neutral.
    const signedIn = Boolean(data.user);
    if (signedIn || req.nextUrl.pathname.startsWith("/login")) {
      const res = pass(signedIn ? "identity" : null);
      for (const { name, value, options } of refreshed) res.cookies.set(name, value, options as never);
      return res;
    }
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
  // api/mcp carries its own bearer-key auth (task #76) — the gate would
  // otherwise demand Basic Auth from every personal agent.
  //
  // api/build carries its own auth too (session OR OPS_FINGERPRINT_TOKEN,
  // constant-time compared, 404 on failure). Gating it here made it useless for
  // the job it exists to do: an unauthenticated caller was redirected to /login,
  // so the ops token never reached the check, and the one endpoint meant to
  // answer "which commit and which database is this?" could not be queried
  // precisely when auth or the database is the thing being diagnosed.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/research|api/mcp|api/build).*)"],
};
