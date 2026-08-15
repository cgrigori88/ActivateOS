import { parse } from "csv-parse/sync";
import {
  CANONICAL_FIELDS,
  type CanonicalField,
  type ColumnMapping,
  type ColumnProfile,
  type InferredType,
  customKey,
  squashHeader,
} from "./fields";

/**
 * CSV shape detection (task #48): delimiter sniffing, header detection,
 * column profiling and the mapping proposal. Pure functions over the file
 * content — deterministic (regex + value corroboration, no AI), so raw
 * partner data never leaves the tenant during analysis. The canonical field
 * registry itself lives in ./fields (shared with the client review UI).
 */

export * from "./fields";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN_RE = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i;
const NUMBERISH_RE = /^[\s$€£]*[\d,.]+\s*[kmb]?$/i;
const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[a-z]{3,9}\.? \d{1,2},? \d{4})/i;

// ── CSV sniffing ─────────────────────────────────────────────────────────────

export interface SniffedCsv {
  delimiter: string;
  headers: string[]; // synthesized ("column_1"…) when the file has no header row
  hasHeaderRow: boolean;
  rows: string[][]; // data rows only, each padded/truncated to headers.length
}

/** Postgres jsonb rejects the NUL byte; strip control chars from cells. */
function cleanCell(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = lines.map((l) => {
      // count delimiters outside quotes
      let n = 0;
      let inQ = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') inQ = !inQ;
        else if (!inQ && ch === d) n++;
      }
      return n;
    });
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    // consistency: how many lines agree with line 1
    const agree = counts.filter((c) => c === first).length / counts.length;
    const score = agree * 10 + Math.min(first, 20) * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Does this row look like column labels rather than data? */
function looksLikeHeader(row: string[], next: string[] | undefined): boolean {
  const cells = row.filter(Boolean);
  if (cells.length === 0) return false;
  // data giveaways in the candidate header
  const dataish = cells.filter((c) => EMAIL_RE.test(c) || (NUMBERISH_RE.test(c) && c.length > 1) || DATE_RE.test(c)).length;
  if (dataish / cells.length > 0.3) return false;
  // headers are distinct
  if (new Set(cells.map((c) => c.toLowerCase())).size < cells.length) return false;
  // if the next row types differ from the candidate (numbers/emails appear), it's a header
  if (next) {
    const nextDataish = next.filter((c) => c && (EMAIL_RE.test(c) || NUMBERISH_RE.test(c) || DATE_RE.test(c))).length;
    if (nextDataish > dataish) return true;
  }
  // all-short, no-digit labels
  return cells.every((c) => c.length <= 64) && dataish === 0;
}

export function sniffCsv(raw: string): SniffedCsv {
  const text = raw.replace(/^\uFEFF/, ""); // BOM
  const delimiter = detectDelimiter(text);
  const parsed: string[][] = parse(text, {
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  });
  const cleaned = parsed.map((r) => r.map(cleanCell)).filter((r) => r.some(Boolean));
  if (cleaned.length === 0) return { delimiter, headers: [], hasHeaderRow: false, rows: [] };

  const hasHeaderRow = looksLikeHeader(cleaned[0], cleaned[1]);
  const width = Math.max(...cleaned.slice(0, 50).map((r) => r.length));
  const headers = hasHeaderRow
    ? cleaned[0].concat(Array(Math.max(0, width - cleaned[0].length)).fill("")).map((h, i) => h || `column_${i + 1}`)
    : Array.from({ length: width }, (_, i) => `column_${i + 1}`);
  const rows = (hasHeaderRow ? cleaned.slice(1) : cleaned).map((r) => {
    const out = r.slice(0, headers.length);
    while (out.length < headers.length) out.push("");
    return out;
  });
  return { delimiter, headers, hasHeaderRow, rows };
}

// ── Column profiling ─────────────────────────────────────────────────────────



export function profileColumns(headers: string[], rows: string[][]): ColumnProfile[] {
  const probe = rows.slice(0, 200);
  return headers.map((header, index) => {
    const values = probe.map((r) => r[index] ?? "").filter(Boolean);
    const fillRate = probe.length ? values.length / probe.length : 0;
    const share = (fn: (v: string) => boolean) => (values.length ? values.filter(fn).length / values.length : 0);
    let type: InferredType = "text";
    if (share((v) => EMAIL_RE.test(v)) > 0.6) type = "email";
    else if (share((v) => DOMAIN_RE.test(v) && !EMAIL_RE.test(v)) > 0.6) type = "domain";
    else if (share((v) => DATE_RE.test(v)) > 0.6) type = "date";
    else if (share((v) => NUMBERISH_RE.test(v)) > 0.7) type = "number";
    const samples: string[] = [];
    for (const v of values) {
      const s = v.slice(0, 60);
      if (!samples.includes(s)) samples.push(s);
      if (samples.length >= 3) break;
    }
    return { index, header, type, fillRate, samples };
  });
}

// ── Mapping proposal ─────────────────────────────────────────────────────────




export function proposeMapping(profiles: ColumnProfile[]): ColumnMapping[] {
  // score every (column, field) pair, then assign greedily best-first so each
  // canonical field maps to at most one column.
  interface Cand {
    col: ColumnProfile;
    field: CanonicalField;
    score: number;
  }
  const cands: Cand[] = [];
  for (const col of profiles) {
    const squashed = squashHeader(col.header);
    if (!squashed || /^column\d+$/.test(squashed)) {
      // headerless file — value patterns are all we have
      for (const field of CANONICAL_FIELDS) {
        if (field.value && col.samples.length > 0 && col.samples.every((s) => field.value!(s))) {
          cands.push({ col, field, score: 0.45 });
        }
      }
      continue;
    }
    for (const field of CANONICAL_FIELDS) {
      const headerHit = field.headers.some((re) => re.test(squashed));
      if (!headerHit) continue;
      let score = 0.75;
      if (field.value && col.samples.length > 0) {
        const okShare = col.samples.filter((s) => field.value!(s)).length / col.samples.length;
        score += okShare >= 0.5 ? 0.2 : -0.45; // values contradict the header → likely a different meaning
      }
      cands.push({ col, field, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);

  const byIndex = new Map<number, ColumnMapping>();
  const takenFields = new Set<string>();
  for (const c of cands) {
    if (c.score < 0.4) continue;
    if (byIndex.has(c.col.index) || takenFields.has(c.field.key)) continue;
    byIndex.set(c.col.index, {
      index: c.col.index,
      header: c.col.header,
      target: c.field.key,
      custom: false,
      confidence: Math.min(1, c.score),
      surfaced: true,
    });
    takenFields.add(c.field.key);
  }

  // everything unmatched is kept as a custom pass-through field — the point of
  // the whole exercise is that "what matters" varies per partner, so nothing
  // is silently dropped. (The operator can still set any column to "skip".)
  return profiles.map((col) => {
    const hit = byIndex.get(col.index);
    if (hit) return hit;
    const isSynthetic = /^column_\d+$/.test(col.header);
    return {
      index: col.index,
      header: col.header,
      target: isSynthetic && col.fillRate < 0.05 ? "" : customKey(col.header),
      custom: true,
      confidence: 0,
      surfaced: !isSynthetic,
    };
  });
}

/** Guess the population category from the filename + mapped fields. */
export function guessCategory(filename: string | null, mapping: ColumnMapping[]): string {
  const f = (filename ?? "").toLowerCase();
  if (/customer|client|install|renewal/.test(f)) return "customer";
  if (/opportunit|pipeline|deal|open/.test(f)) return "open_opportunity";
  if (/prospect|lead|outbound/.test(f)) return "prospect";
  if (/target/.test(f)) return "target";
  const keys = new Set(mapping.map((m) => m.target));
  if (keys.has("renewal_date") || keys.has("installed_products")) return "customer";
  if (keys.has("deal_stage") || keys.has("close_date")) return "open_opportunity";
  return "custom";
}
