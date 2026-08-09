import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * HTTP Basic Auth gate for deployed environments. Active only when
 * BASIC_AUTH_USER and BASIC_AUTH_PASS are set (so local dev is untouched);
 * covers every route including server actions. Replace with real
 * multi-tenant auth when customers arrive.
 */
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u === user && p === pass) return NextResponse.next();
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
