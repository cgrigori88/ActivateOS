import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWLIST, type Allow } from "./ordering-scan-allowlist";

/**
 * Mechanical ordering scanner for the D-G8-2A bounded sweep.
 *
 * WHY MECHANICAL. Five LLM audit rounds each reached root files the previous round had never examined
 * (24 -> 6 -> 7 -> 9 -> 44 findings). A convergence claim has to be reproducible from fixed inputs, so the
 * pre-fix and post-fix audits run THIS scanner, at THIS version, with THIS allowlist, over a FROZEN closure
 * manifest. Anyone can re-run it and get the same verdict.
 *
 * v1.1.0 — v1.0.0 was wrong and its 177-finding count must not be quoted. Its `orderByOf` matched the first
 * `order by` and ran to end-of-string, so any query with a LATERAL or subquery ORDER BY was judged on the
 * wrong terminal term; it re-flagged sites that were already fixed and certified (horizon.ts, populations.ts,
 * writeback.ts, accounts/page.tsx). This version extracts EVERY order-by clause with a paren-aware scan and
 * judges each independently, skips `array_agg(distinct X order by X)` (total over de-duplicated values), and
 * accepts any genuine terminal tie-break key rather than only id-shaped ones.
 *
 * WHAT IT FLAGS:
 *   P1_ORDER_NOT_TOTAL  an ORDER BY clause that does not end in a unique/stable key, in a block that caps
 *                       (`limit`), de-duplicates (`distinct on`), or aggregates with an order.
 *   P2_CAP_NO_ORDER     a block with `limit` and no ORDER BY at all.
 *   P3_AGG_ORDER        `array_agg(… order by …)` whose internal order is not total and is not a
 *                       `distinct` aggregate ordered by its own distinct expression.
 *   P4_SORT_THEN_CUT    a JS `.sort(…)` feeding `.slice(…)` or `[0]` whose comparator has no terminal key.
 *
 * DELIBERATELY NOT A JUDGE. It cannot tell "membership under a cap" from "display-only", nor see a unique
 * constraint. Everything it raises ends either FIXED in the product or in the allowlist WITH A REASON, so a
 * reported zero is a statement about this config — which is reviewable — not about taste.
 *
 *   npx tsx scripts/ordering-scan.ts --manifest docs/vnext/D-G8-2A-CLOSURE-MANIFEST.txt
 *
 * Exit 0 when no unallowed findings remain.
 */

export const SCANNER_VERSION = "1.1.0";

/** A terminal ORDER BY key is unique when it is id-shaped. Anything else needs an allowlist reason. */
const UNIQUE_TERM_RX = /^(?:[a-z_][a-z0-9_]*\.)?(?:id|[a-z_]*_id)$/i;
/** A JS comparator's final term counts as a tie-break when it compares a key rather than two magnitudes. */
const JS_TERMINAL_KEY_RX = /localeCompare|\.id\b|\bId\b|\.key\b|\.href\b|\.name\b|\ba\.i\b|\bi\b\s*-/;

export interface Finding {
  file: string;
  line: number;
  pattern: "P1_ORDER_NOT_TOTAL" | "P2_CAP_NO_ORDER" | "P3_AGG_ORDER" | "P4_SORT_THEN_CUT";
  clause: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const lineAt = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

/**
 * Every ORDER BY clause in a statement, each bounded correctly: a paren-aware scan that stops at the `)`
 * closing an enclosing subquery/lateral, or at the next top-level clause keyword. This is the fix for the
 * v1.0.0 defect — ORDER BY terms legitimately contain parens (`coalesce(a, b)`, `(x = 'y') desc`), so the
 * boundary cannot be found by searching for the next `)`.
 */
export function orderByClauses(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\border by\s+/gi)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 0, i = start;
    for (; i < sql.length; i++) {
      const c = sql[i];
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) break; depth--; }
      else if (depth === 0 && /\s/.test(c)
        && /^\s+(limit|offset|group\s+by|having|union|window|returning|on\s+true)\b/i.test(sql.slice(i))) break;
    }
    const clause = norm(sql.slice(start, i));
    if (clause) out.push(clause);
  }
  return out;
}

/** Does an ORDER BY clause end in a unique key? */
export function endsUnique(order: string): boolean {
  // split on top-level commas only — `coalesce(a, b)` must not be split
  const terms: string[] = [];
  let depth = 0, cur = "";
  for (const c of order) {
    if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (c === "," && depth === 0) { terms.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) terms.push(cur);
  const last = (terms.pop() ?? "").trim()
    .replace(/\s+(asc|desc)\b/gi, "")
    .replace(/\s+nulls\s+(first|last)\b/gi, "")
    .trim();
  return UNIQUE_TERM_RX.test(last);
}

function sqlBlocks(src: string): { sql: string; idx: number }[] {
  const out: { sql: string; idx: number }[] = [];
  for (const m of src.matchAll(/`([^`]*\bselect\b[^`]*)`/gi)) out.push({ sql: norm(m[1]), idx: m.index ?? 0 });
  return out;
}

function sortCalls(src: string): { comparator: string; after: string; idx: number }[] {
  const out: { comparator: string; after: string; idx: number }[] = [];
  for (const m of src.matchAll(/\.sort\s*\(/g)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1, i = start;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    out.push({ comparator: norm(src.slice(start, i - 1)), after: src.slice(i, i + 160), idx: m.index ?? 0 });
  }
  return out;
}

function allowed(file: string, clause: string): Allow | undefined {
  return ALLOWLIST.find((a) => a.file === file && clause.includes(a.match));
}

export function scanFile(file: string, src: string): Finding[] {
  const found: Finding[] = [];

  for (const { sql, idx } of sqlBlocks(src)) {
    const line = lineAt(src, idx);
    const capped = /\blimit\s+(\d+|\$\d+)/i.test(sql);
    const dedup = /\bdistinct on\s*\(/i.test(sql);
    const clauses = orderByClauses(sql);

    if (capped && clauses.length === 0) {
      found.push({ file, line, pattern: "P2_CAP_NO_ORDER", clause: "(capped, no ORDER BY)" });
    }
    if (capped || dedup) {
      for (const c of clauses) if (!endsUnique(c)) found.push({ file, line, pattern: "P1_ORDER_NOT_TOTAL", clause: c });
    }

    for (const agg of sql.matchAll(/array_agg\s*\(\s*(distinct\s+)?([^)]*?)\border by\b([^)]*)\)/gi)) {
      const isDistinct = Boolean(agg[1]);
      const expr = norm(agg[2]);
      const inner = norm(agg[3]);
      // `array_agg(distinct x order by x)` is total: the values are de-duplicated and ordered by themselves.
      if (isDistinct && inner.replace(/\s+(asc|desc)\b/gi, "").trim() === expr) continue;
      if (!endsUnique(inner)) found.push({ file, line, pattern: "P3_AGG_ORDER", clause: inner });
    }
  }

  for (const { comparator, after, idx } of sortCalls(src)) {
    const cut = /^\s*\.slice\s*\(/.test(after) || /^\s*\[\s*0\s*\]/.test(after);
    if (!cut || !comparator) continue;
    const terms = comparator.split("||");
    const last = (terms.pop() ?? "").trim();
    if (!JS_TERMINAL_KEY_RX.test(last)) {
      found.push({ file, line: lineAt(src, idx), pattern: "P4_SORT_THEN_CUT", clause: comparator.slice(0, 120) });
    }
  }

  return found.filter((f) => !allowed(f.file, f.clause));
}

function main(): void {
  const argv = process.argv;
  const at = argv.indexOf("--manifest");
  if (at < 0) { console.error("usage: ordering-scan.ts --manifest <path>"); process.exitCode = 2; return; }
  const manifestPath = argv[at + 1];
  const files = readFileSync(resolve(process.cwd(), manifestPath), "utf8").split("\n").filter(Boolean);

  console.log(`[ordering-scan] scanner ${SCANNER_VERSION} · manifest ${manifestPath} · ${files.length} files · allowlist ${ALLOWLIST.length}`);

  const findings: Finding[] = [];
  for (const file of files) {
    let src: string;
    try { src = readFileSync(resolve(process.cwd(), file), "utf8"); } catch { continue; }
    findings.push(...scanFile(file, src));
  }

  const byPattern = new Map<string, number>();
  for (const f of findings) byPattern.set(f.pattern, (byPattern.get(f.pattern) ?? 0) + 1);
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`  ${f.pattern.padEnd(19)} ${f.file}:${f.line}  ${f.clause.slice(0, 110)}`);
  }
  console.log(`\n  by pattern: ${[...byPattern.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ") || "none"}`);
  console.log(`  TOTAL UNALLOWED FINDINGS: ${findings.length}`);
  process.exitCode = findings.length === 0 ? 0 : 1;
}

main();
