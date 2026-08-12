import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for bearer secrets. Hash both sides first so inputs
 * of different lengths compare safely (timingSafeEqual requires equal-length
 * buffers) and no length information leaks either.
 */
export function secretEquals(candidate: string, secret: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
