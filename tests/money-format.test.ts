import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatCompact, formatMoneyExact, formatCost } from "../src/lib/format/money";

/**
 * The cases the redesign brief named explicitly, plus the malformations it
 * banned. `$6250k` is the one that shipped, so it gets its own assertion: an
 * amount over a million must never render in thousands.
 */
test("formatMoney renders the brief's canonical examples", () => {
  assert.equal(formatMoney(0), "$0");
  assert.equal(formatMoney(920_000), "$920K");
  assert.equal(formatMoney(990_000), "$990K");
  assert.equal(formatMoney(1_120_000), "$1.12M");
  assert.equal(formatMoney(1_450_000), "$1.45M");
  assert.equal(formatMoney(2_610_000), "$2.61M");
  assert.equal(formatMoney(6_250_000), "$6.25M");
  assert.equal(formatMoney(8_830_000), "$8.83M");
});

test("meaningless trailing zeroes are trimmed", () => {
  assert.equal(formatMoney(1_300_000), "$1.3M");
  assert.equal(formatMoney(1_000_000), "$1M");
  assert.equal(formatMoney(2_000_000_000), "$2B");
});

test("fixed precision is available where a column must align", () => {
  assert.equal(formatMoney(1_300_000, { fixed: true }), "$1.30M");
  assert.equal(formatMoney(1_000_000, { fixed: true }), "$1.00M");
});

test("the banned renderings can no longer be produced", () => {
  for (const n of [6_250_000, 1_450_000, 1_120_000, 8_830_000, 0]) {
    const out = formatMoney(n);
    assert.ok(!/\d{4,}[kK]/.test(out), `${n} rendered as ${out} — four+ digits before k`);
    assert.notEqual(out, "$0k");
    assert.ok(!out.endsWith("k"), `${n} rendered as ${out} — lowercase k suffix`);
  }
});

test("below a thousand stays un-abbreviated", () => {
  assert.equal(formatMoney(847), "$847");
  assert.equal(formatMoney(999), "$999");
  assert.equal(formatMoney(1), "$1");
});

test("a decimal is kept where dropping it would move the value materially", () => {
  // $1K vs $1.5K is a third of the amount — never immaterial.
  assert.equal(formatMoney(1_500), "$1.5K");
  assert.equal(formatMoney(9_900), "$9.9K");
  // By $10K a single unit is 1%, so digits stop earning their space.
  assert.equal(formatMoney(10_000), "$10K");
  assert.equal(formatMoney(47_300), "$47K");
});

test("band boundaries land on the correct unit", () => {
  assert.equal(formatMoney(999), "$999");
  assert.equal(formatMoney(1_000), "$1K");
  // Rounding must not push a value outside its own unit: $999,999 is "$1M",
  // never "$1000K".
  assert.equal(formatMoney(999_999), "$1M");
  assert.equal(formatMoney(1_000_000), "$1M");
  assert.equal(formatMoney(999_999_999), "$1B");
  assert.equal(formatMoney(1_000_000_000), "$1B");
});

test("null, undefined and NaN yield the fallback, not $0", () => {
  // The distinction matters: PursuitOS treats UNKNOWN and zero as different
  // facts, and a formatter that renders null as "$0" would erase that.
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(undefined), "—");
  assert.equal(formatMoney(NaN), "—");
  assert.equal(formatMoney(null, { fallback: "Not established" }), "Not established");
  assert.equal(formatMoney(0), "$0");
});

test("negatives keep their sign", () => {
  assert.equal(formatMoney(-1_450_000), "-$1.45M");
  assert.equal(formatMoney(-500), "-$500");
});

test("formatCompact handles non-currency quantities", () => {
  assert.equal(formatCompact(47), "47");
  assert.equal(formatCompact(1_200), "1.2K");
  assert.equal(formatCompact(15_000), "15K");
  assert.equal(formatCompact(3_400_000), "3.4M");
  assert.equal(formatCompact(null), "—");
});

test("formatMoneyExact keeps the whole figure with separators", () => {
  assert.equal(formatMoneyExact(6_250_000), "$6,250,000");
  assert.equal(formatMoneyExact(920_000), "$920,000");
  assert.equal(formatMoneyExact(0), "$0");
  assert.equal(formatMoneyExact(null), "—");
});

test("a currency code selects its symbol without converting the amount", () => {
  // Records carry a currency code (pursuits.currency); the Pursuit room used to
  // render it through a second Intl formatter with its own rounding, so the
  // hero disagreed with the value case on the same page.
  assert.equal(formatMoney(1_250_000, { currency: "USD" }), "$1.25M");
  assert.equal(formatMoney(1_250_000, { currency: "EUR" }), "€1.25M");
  assert.equal(formatMoney(1_250_000, { currency: "GBP" }), "£1.25M");
  // The amount is rendered as stored — a currency code is not an exchange rate.
  assert.equal(
    formatMoney(1_250_000, { currency: "JPY" }).replace(/^[^\d-]+/, ""),
    formatMoney(1_250_000, { currency: "USD" }).replace(/^[^\d-]+/, ""),
  );
  assert.equal(formatMoney(920_000, { currency: "usd" }), "$920K");
  assert.equal(formatMoney(null, { currency: "EUR" }), "—");
});

test("an unrecognized currency code shows the code, never a wrong symbol", () => {
  // Printing "$" beside an amount held in another currency misstates what the
  // number is. Falling back to the code is honest.
  assert.equal(formatMoney(1_250_000, { currency: "ZZZ" }), "ZZZ1.25M");
  assert.equal(formatMoney(1_250_000, { currency: "not-a-code" }), "NOT-A-CODE1.25M");
});

test("an explicit symbol wins over a currency code", () => {
  assert.equal(formatMoney(1_250_000, { currency: "EUR", symbol: "" }), "1.25M");
  assert.equal(formatMoney(1_250_000, { currency: "EUR", symbol: "$" }), "$1.25M");
});

test("formatMoneyExact honours the currency code too", () => {
  assert.equal(formatMoneyExact(920_000, { currency: "EUR" }), "€920,000");
  assert.equal(formatMoneyExact(-920_000, { currency: "GBP" }), "-£920,000");
});

test("the hero and the value case cannot disagree about one amount", () => {
  // The exact regression the consolidation closed: two formatters, one number.
  // Every path that renders a commercial amount goes through formatMoney, so
  // the same input has exactly one rendering.
  const amount = 1_250_000;
  const viaCurrency = formatMoney(amount, { currency: "USD" });
  const viaDefault = formatMoney(amount);
  assert.equal(viaCurrency, viaDefault);
  assert.equal(viaCurrency, "$1.25M");
  assert.notEqual(viaCurrency, "$1.3M");
});

test("no surface renders a doubled currency symbol", () => {
  // A JSX literal `$` in front of {formatMoney(...)} produced "$$1.45M" on the
  // Pipeline roll-up. formatMoney supplies its own symbol, so any caller that
  // also supplies one is a bug — this asserts the formatter's half of that
  // contract, and scripts/visual-system-check.ts guards the call sites.
  for (const n of [1_450_000, 920_000, 0, 847]) {
    const out = formatMoney(n);
    assert.ok(!out.startsWith("$$"), `${n} rendered ${out}`);
    assert.equal((out.match(/\$/g) ?? []).length, 1, `${n} rendered ${out}`);
  }
});

test("formatCost keeps sub-dollar operational spend legible", () => {
  // Admin had three recipes for one figure. The bare interpolation could print
  // a full float — "$0.00034500000000000004" — in a table cell.
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.0035), "$0.0035");
  // 0.00345 is held as 0.003449999…, so four decimals is "$0.0034". That is a
  // faithful rendering of the stored value, not a rounding bug.
  assert.equal(formatCost(0.00345), "$0.0034");
  assert.equal(formatCost(0.000345), "$0.0003");
  assert.equal(formatCost(0.5), "$0.50");
  assert.equal(formatCost(0.1), "$0.10");
  assert.equal(formatCost(12.3456), "$12.35");
  assert.equal(formatCost(1234.5), "$1,234.50");
  assert.equal(formatCost(-2.5), "-$2.50");
  assert.equal(formatCost(null), "—");
  assert.equal(formatCost(undefined), "—");
  assert.equal(formatCost(NaN), "—");
  assert.equal(formatCost(null, "no runs"), "no runs");
});

test("formatCost never emits a raw float tail", () => {
  for (const n of [0.00034500000000000004, 1 / 3, 2 / 7, 0.1 + 0.2]) {
    const out = formatCost(n);
    const decimals = (out.split(".")[1] ?? "").length;
    assert.ok(decimals >= 2 && decimals <= 4, `${n} rendered ${out}`);
  }
});
