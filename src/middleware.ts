import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * HTTP Basic Auth gate for deployed environments. Active only when
 * BASIC_AUTH_USER and BASIC_AUTH_PASS are set (so local dev is untouched);
 * covers every route including server actions. Replace with real
 * multi-tenant auth when customers arrive.
 *
 * Credentials are compared as SHA-256 digests rather than with `===` on the
 * raw strings: a plain string compare exits on the first differing character,
 * which leaks a timing signal an attacker can use to recover the value
 * byte-by-byte. Comparing fixed-length hashes removes the useful signal.
 */

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      const [uHash, pHash, userHash, passHash] = await Promise.all([digest(u), digest(p), digest(user), digest(pass)]);
      if (uHash === userHash && pHash === passHash) return NextResponse.next();
    } catch {
      /* malformed base64 → fall through to 401 */
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PursuitOS"' },
  });
}

export const config = {
  // Webhooks authenticate with provider signatures (svix); the research trigger
  // authenticates with its own bearer secret — neither uses Basic Auth.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/research).*)"],
};
