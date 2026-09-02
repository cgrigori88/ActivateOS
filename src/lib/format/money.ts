/**
 * The one place a commercial amount becomes text a human reads.
 *
 * Before this existed there were NINETEEN local formatters — `usdShort` on
 * Today, `money` on Partners, another `money` on Analytics, an inline
 * `` `$${formatMoney(n)}` `` copy-pasted into a dozen components. They
 * disagreed on precision (`.toFixed(2)` here, `.toFixed(1)` there), on the
 * fallback for null (`—` vs nothing vs `$0`), and on where abbreviation starts.
 *
 * The visible symptom was `$6250k`, `$1450k`, `$8830k`, `$0k` — amounts over a
 * million rendered in thousands because the local helper only had one branch.
 * A reader has to count digits to know whether `$6250k` is six million or six
 * hundred thousand, and on a screen shown to a distributor that is not a
 * cosmetic problem.
 *
 * PRESENTATION ONLY. Nothing here rounds a stored value, changes arithmetic, or
 * feeds a calculation — callers pass a number and receive a string.
 */

/** Scale at which abbreviation begins. Below this, digits are clearer than a suffix. */
const K = 1_000;
const M = 1_000_000;
const B = 1_000_000_000;

/**
 * Trailing zeroes after a decimal point carry no information — `$1.30M` and
 * `$1.3M` are the same number, and the second reads faster. Whole values lose
 * the point entirely: `$1.00M` → `$1M`.
 */
function trim(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

export interface MoneyOptions {
  /** Rendered when the amount is null/undefined/NaN. Defaults to an em dash. */
  fallback?: string;
  /**
   * Keep trailing zeroes — for a column where every row must have the same
   * decimal width or the digits will not line up. Off by default.
   */
  fixed?: boolean;
  /** Currency symbol. Only the symbol changes; no conversion is performed. */
  symbol?: string;
  /**
   * ISO currency code carried on the record (`pursuits.currency` and friends).
   * Resolves to that currency's symbol; `symbol` still wins if both are given.
   * NO CONVERSION IS PERFORMED — the amount is rendered as stored.
   */
  currency?: string | null;
}

/**
 * Currency code → symbol, via Intl so the mapping is not a hand-maintained
 * table that silently goes stale.
 *
 * An unrecognized code falls back to the CODE ITSELF, never to `$`. Printing
 * "$" beside an amount stored in another currency misstates what the number is,
 * and on a screen shown to a distributor that is a commercial error, not a
 * cosmetic one — "ZZZ 1.2M" is honest where "$1.2M" is not.
 */
const SYMBOLS = new Map<string, string>();
function currencySymbol(code: string): string {
  const key = code.trim().toUpperCase();
  const cached = SYMBOLS.get(key);
  if (cached !== undefined) return cached;
  let symbol = key;
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: key,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    symbol = parts.find((p) => p.type === "currency")?.value ?? key;
  } catch {
    symbol = key; // RangeError: not a currency code we know.
  }
  SYMBOLS.set(key, symbol);
  return symbol;
}

/** The symbol a caller's options ask for. `symbol` is explicit and wins. */
function resolveSymbol(opts: MoneyOptions): string {
  if (opts.symbol !== undefined) return opts.symbol;
  if (opts.currency) return currencySymbol(opts.currency);
  return "$";
}

/**
 * Format a commercial amount for display.
 *
 *   0            → "$0"
 *   847          → "$847"        below a thousand, digits beat a suffix
 *   1_500        → "$1.5K"       a decimal matters most at the low end of a band
 *   920_000      → "$920K"
 *   1_300_000    → "$1.3M"
 *   6_250_000    → "$6.25M"      NOT "$6250k"
 *   2_400_000_000→ "$2.4B"
 *
 * Precision is chosen so the abbreviation never misrepresents the number by
 * more than a rounding step a reader would consider immaterial at that scale:
 * two decimals in the millions and billions, and one below ten of any unit
 * where a single digit would round away a fifth of the value.
 */
export function formatMoney(amount: number | null | undefined, opts: MoneyOptions = {}): string {
  const { fallback = "—", fixed = false } = opts;
  if (amount == null || !Number.isFinite(amount)) return fallback;
  const symbol = resolveSymbol(opts);

  const negative = amount < 0;
  const n = Math.abs(amount);
  const sign = negative ? "-" : "";

  const scaled = (value: number, unit: string, decimals: number) => {
    const raw = value.toFixed(decimals);
    return `${sign}${symbol}${fixed ? raw : trim(raw)}${unit}`;
  };

  if (n === 0) return `${symbol}0`;
  // Below a thousand there is nothing to abbreviate: "$847" is already short,
  // and "$0.8K" would be both longer and less precise.
  if (n < K) return `${sign}${symbol}${Math.round(n)}`;

  // Choose the unit AFTER rounding, not before. $999,999 is under a million, so
  // a naive band test picks K and rounding then produces "$1000K" — a value
  // rendered outside its own unit. Promoting when the rounded figure reaches
  // 1000 gives "$1M", which is what the number actually is.
  const bands: Array<{ divisor: number; unit: string; decimals: number }> = [
    { divisor: K, unit: "K", decimals: n < 10 * K ? 1 : 0 },
    { divisor: M, unit: "M", decimals: 2 },
    { divisor: B, unit: "B", decimals: 2 },
  ];
  for (const band of bands) {
    const value = n / band.divisor;
    if (value < 1000 || band.unit === "B") {
      // Guard the boundary: if rounding at this precision reaches 1000, the
      // next band is the honest one.
      if (Number(value.toFixed(band.decimals)) >= 1000 && band.unit !== "B") continue;
      return scaled(value, band.unit, band.decimals);
    }
  }
  return scaled(n / B, "B", 2);
}

/**
 * The same treatment for counts and other non-currency quantities: 1_200 →
 * "1.2K", 3_400_000 → "3.4M". Small numbers are returned as digits, because a
 * count of 47 is never clearer as "47".
 */
export function formatCompact(value: number | null | undefined, fallback = "—"): string {
  if (value == null || !Number.isFinite(value)) return fallback;
  const negative = value < 0;
  const n = Math.abs(value);
  const sign = negative ? "-" : "";
  if (n < K) return `${sign}${Math.round(n)}`;
  if (n < M) return `${sign}${trim((n / K).toFixed(n < 10 * K ? 1 : 0))}K`;
  if (n < B) return `${sign}${trim((n / M).toFixed(1))}M`;
  return `${sign}${trim((n / B).toFixed(1))}B`;
}

/**
 * Operational spend, where fractions of a cent are the unit — model cost per
 * agent run, aggregated AI spend on Admin.
 *
 * This is a different job from a commercial amount and needs different rules:
 * `formatMoney` would render a $0.0035 run as "$0", which is not what it cost.
 * Admin had three inline recipes for it (`.toFixed(2)`, `.toFixed(3)`, and a
 * bare interpolation that could print "$0.00034500000000000004"), so the
 * precision of a cost depended on which table you were looking at.
 *
 *   0        → "$0.00"
 *   0.00345  → "$0.0035"     below a dollar, cents are too coarse to say anything
 *   0.5      → "$0.50"
 *   12.3456  → "$12.35"      at a dollar and up, cents are the unit
 *   1234.5   → "$1,234.50"
 */
export function formatCost(amount: number | null | undefined, fallback = "—"): string {
  if (amount == null || !Number.isFinite(amount)) return fallback;
  const negative = amount < 0;
  const n = Math.abs(amount);
  const sign = negative ? "-" : "";
  if (n === 0) return "$0.00";
  if (n < 1) {
    // Trim to at most four decimals, but never below two — "$0.50" reads as
    // money where "$0.5" reads as a number that lost a digit.
    const trimmed = trim(n.toFixed(4));
    const decimals = (trimmed.split(".")[1] ?? "").length;
    return `${sign}$${decimals < 2 ? n.toFixed(2) : trimmed}`;
  }
  return `${sign}$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A whole-dollar rendering with separators, for the places where the exact
 * figure is the point — a settlement line, an invoice, a value-case input the
 * reader is expected to check rather than skim.
 */
export function formatMoneyExact(amount: number | null | undefined, opts: MoneyOptions = {}): string {
  const { fallback = "—" } = opts;
  if (amount == null || !Number.isFinite(amount)) return fallback;
  const symbol = resolveSymbol(opts);
  const negative = amount < 0;
  return `${negative ? "-" : ""}${symbol}${Math.round(Math.abs(amount)).toLocaleString("en-US")}`;
}
