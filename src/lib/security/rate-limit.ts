/**
 * Fixed-window in-memory rate limiter (#66). Edge- and Node-safe: no imports,
 * no timers — just a Map that self-prunes.
 *
 * Scope honestly stated: counters are PER INSTANCE. On serverless each warm
 * lambda/edge isolate keeps its own window, so the effective ceiling is
 * limit × concurrent instances — that still collapses credential stuffing
 * from thousands/minute to a handful, which is what this layer is for.
 * A shared store (Redis-class) is the upgrade path if the app outgrows it;
 * tracked on the security roadmap.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** True when `key` has EXCEEDED `limit` hits inside the current window. */
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

/** Best client identity available behind Vercel/Railway proxies. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
