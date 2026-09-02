/**
 * Visual-system detector (Wave 1 §15).
 *
 * Wave 1 consolidated the interface onto one set of tokens and primitives. This
 * exists so it stays consolidated: the previous normalization held for exactly
 * as long as nobody added a page, because nothing failed when they did.
 *
 * DESIGNED TO BE NARROW. Every rule below encodes a violation the audit actually
 * measured, and each has an escape hatch for the legitimate exception. A
 * detector that cries wolf gets suppressed, and a suppressed detector is worse
 * than none — so charts, canvases and genuine one-offs are exempt by path, and
 * `rounded-full` (a pill IS a radius in the system) is allowed everywhere.
 *
 *   npx tsx scripts/visual-system-check.ts          check the whole app
 *   npx tsx scripts/visual-system-check.ts --staged only files staged in git
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

interface Rule {
  id: string;
  why: string;
  test: RegExp;
  /** Paths where this rule does not apply, because the exception is legitimate. */
  exempt?: RegExp;
  /**
   * Ignore hits that sit inside a template literal. `\`amount>${formatMoney(x)}\``
   * is a read-back string where `>` is a comparison operator, not a JSX tag —
   * flagging it would be the false positive §15 warns about.
   */
  codeOnly?: boolean;
}

const RULES: Rule[] = [
  {
    id: "arbitrary-font-size",
    why: "font sizes come from the named scale (text-micro…text-hero), not from a pixel literal",
    test: /\btext-\[\d+(?:\.\d+)?px\]/g,
  },
  {
    id: "half-pixel-font-size",
    why: "nobody designs on a 0.5px grid on purpose",
    test: /\btext-\[\d+\.\d+px\]|fontSize:\s*\d+\.\d+\b/g,
  },
  {
    id: "inline-font-size",
    // `fontSize: 17` bypasses the named scale silently, and the half-pixel rule
    // above could not see it when it hid inside a ternary
    // (`fontSize: material === "high" ? 17 : … : 13.5`), which is exactly where
    // Pipeline's off-scale sizes were living. Any numeric fontSize is caught.
    why: "font sizes come from the named scale (text-micro…text-hero), not an inline pixel number",
    test: /fontSize:\s*(?:\d|[^,}]*\?[^,}]*\d)/g,
    // global-error cannot rely on the stylesheet having loaded — see below.
    exempt: /app\/global-error\.tsx/,
  },
  {
    id: "parallel-type-scale",
    why: "text-sm/text-xs are a second type scale competing with the named roles",
    test: /\btext-(?:xs|sm|base|2xl|3xl|4xl)\b/g,
  },
  {
    id: "page-authored-button-colour",
    why: "a filled CTA is buttonClass('primary'); green and violet CTAs were four grammars for one job",
    test: /<button[^>]*className="[^"]*\bbg-(?:blue|green|violet|neutral-900|neutral-800)-?\d*\b/g,
  },
  {
    id: "inline-styled-button",
    // The className rule above only sees Tailwind colour utilities. The Pursuit
    // room painted its CTAs through `style={{ background: "var(--color-route)" }}`
    // instead — invisible to that rule, and five more filled-button grammars on
    // one screen. A button's fill comes from buttonClass, full stop.
    why: "button fills come from buttonClass(variant), not an inline style",
    test: /<button(?:(?!<button|<\/)[\s\S]){0,300}?style=\{\{[^{}]*background/g,
    // global-error renders when the root layout itself failed, so it cannot
    // assume the stylesheet loaded. Inline style is the only option there.
    exempt: /app\/global-error\.tsx/,
  },
  {
    id: "parallel-money-formatter",
    // Two `Intl` currency formatters outlived the money consolidation because
    // they did not look like the `Math.round(n / 1000)` shape the codemod
    // matched. Cost: the Pursuit hero read "$1.3M" while its own value case
    // read "$1.25M" for the same stored amount.
    why: "currency rendering lives in lib/format/money.ts — a second formatter means two rounding policies",
    test: /style:\s*"currency"/g,
    exempt: /lib\/format\/money\.ts/,
  },
  {
    id: "page-local-radius",
    // Bare `rounded` (4px) is the fourth Tailwind radius and the easiest one to
    // reach for by reflex — 63 chips, code spans and bar tracks had it. Policing
    // sm/md/lg while leaving it was a hole in the lock, not a deliberate
    // exception, so the bare form is caught too. `rounded-full` stays legal: a
    // pill IS a radius in this system.
    why: "radii are rounded-inner/control/card/panel or rounded-full — not Tailwind's scale",
    test: /\brounded-(?:sm|md|lg)\b|(?<![-\w])rounded(?![-\w])/g,
  },
  {
    id: "page-local-shadow",
    // Only real ELEVATION is policed. `inset` highlights and zero-blur rings
    // (`0_0_0_1px`) are surface material — the rail's glass rim is one — not a
    // competing elevation recipe, and flagging them would train people to
    // ignore this detector.
    why: "elevation is var(--shadow-low|medium|float), not a bespoke drop-shadow recipe",
    test: /\bshadow-\[(?!var\(--shadow|inset|0_0_0_)/g,
  },
  {
    id: "dom-position-colour",
    why: "colour must carry meaning; nth-child made a tile's hue depend on where it sat",
    test: /nth-child\(\s*\d+n/g,
  },
  {
    id: "doubled-currency-symbol",
    // Found on the Pipeline roll-up as "$$2.75M". The money codemod rewrote
    // `` ${Math.round(n / 1000)}k `` in place, which is correct inside a
    // template literal and WRONG in JSX: there the leading `$` is a literal
    // character and `{formatMoney(n)}` already supplies one.
    //
    // Both JSX boundaries the codemod produced are policed — a tag close
    // (`>${formatMoney(x)}`) and a preceding expression (`{sign}${formatMoney(x)}`).
    // `codeOnly` then drops matches inside a template literal, where the same
    // characters are the correct interpolation.
    why: "formatMoney supplies its own currency symbol; a literal $ in front of it doubles up",
    test: /[>}]\s*\$\{\s*(?:formatMoney|formatCompact|formatMoneyExact|usd|compactMoney)\s*\(/g,
    codeOnly: true,
  },
  {
    id: "hand-rolled-money",
    why: "commercial amounts go through formatMoney — this is how $6250k shipped",
    test: /\}\s*k`|\/\s*1_?000\s*\)\s*\}\s*k|\(\s*\w+\s*\/\s*1_000_000\s*\)\.toFixed/g,
    exempt: /lib\/format\/money\.ts/,
  },
];

/** Charts and canvases legitimately need exact geometry; the landing page is out of scope. */
const GLOBAL_EXEMPT = /\/(landing)\/|hero-mesh|sparkline|mini-bar|\.test\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const staged = process.argv.includes("--staged");
const files = staged
  ? execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /^src\/.*\.tsx?$/.test(f))
  : walk("src");

let violations = 0;
const byRule = new Map<string, number>();

for (const file of files) {
  if (GLOBAL_EXEMPT.test(file)) continue;
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue; // staged-but-deleted
  }
  // Comments describe the old world on purpose (that is what a code comment is
  // for); only live code is checked.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const rule of RULES) {
    if (rule.exempt?.test(file)) continue;
    const hits: string[] = [];
    for (const m of code.matchAll(rule.test)) {
      if (rule.codeOnly && m.index !== undefined) {
        // An odd number of backticks earlier on the line means this match sits
        // inside a template literal, where the syntax is legitimate.
        const lineStart = code.lastIndexOf("\n", m.index) + 1;
        const before = code.slice(lineStart, m.index);
        if ((before.match(/`/g) ?? []).length % 2 === 1) continue;
      }
      hits.push(m[0]);
    }
    if (!hits.length) continue;
    violations += hits.length;
    byRule.set(rule.id, (byRule.get(rule.id) ?? 0) + hits.length);
    console.log(`  ${file}`);
    console.log(`    ${rule.id} ×${hits.length} — ${rule.why}`);
    console.log(`    e.g. ${hits.slice(0, 3).join("  ")}`);
  }
}

console.log(
  violations === 0
    ? `\nvisual system clean — ${files.length} files checked`
    : `\n${violations} violation(s) across ${byRule.size} rule(s) in ${files.length} files`,
);
if (violations > 0) {
  for (const [id, n] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${id}`);
}
process.exit(violations > 0 ? 1 : 0);
