/**
 * Commercial significance helpers (TD SYNNEX pre-demo, Ask UX §2).
 *
 * An executive reading an answer wants to know what is at stake before they want to know which
 * intent produced it. `significance` carries that figure — but only where the resolver can compute
 * it from the very rows it just returned. There is no fallback, no estimate and no "approximately":
 * a resolver with no honest single figure supplies none and the surface shows none.
 *
 * `basis` is mandatory, not decorative. A total with no statement of what it sums is exactly the
 * kind of confident number this product exists to refuse.
 */

export const usd = (n: number): string =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;

export interface Significance { label: string; value: string; basis: string }

/** Build a significance only when the figure is real and non-zero. Otherwise: nothing. */
export function money(label: string, total: number, basis: string): Significance | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return { label, value: usd(total), basis };
}
