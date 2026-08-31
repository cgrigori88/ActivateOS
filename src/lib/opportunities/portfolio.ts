import type { ConditionState } from "./condition";

/**
 * Pipeline Portfolio pivot (scale-disclosure §3.2 / R4). An ecosystem-native aggregation over the
 * canonical opportunity set — weighted $ and count per {row dimension × column dimension}. No new
 * data: every dimension is read from existing columns/relationships. A dimension with no data is
 * simply UNAVAILABLE (the caller hides it) — never synthesized. Clicking a cell drills into the
 * underlying reconciled records (Attention view) under the current scope.
 */

export type RowDim = "partner" | "vendor" | "territory" | "seller";
export type ColDim = "condition" | "stage" | "partner";

/** A normalized opportunity for pivoting — assembled by the page from already-loaded canonical data. */
export interface PortfolioOpp {
  amountUsd: number | null;
  weighted: number;
  stage: string;
  closed: boolean;
  condition: ConditionState;
  partner: string | null;
  vendor: string | null;
  territory: string | null;
  seller: string | null;
}

export interface PortfolioCell { usd: number; weighted: number; count: number; }
export interface PortfolioRow { key: string; cells: Record<string, PortfolioCell>; total: PortfolioCell; }
export interface Portfolio {
  rowDim: RowDim;
  colDim: ColDim;
  colKeys: string[];
  rows: PortfolioRow[];
  totals: Record<string, PortfolioCell>;
  grandTotal: PortfolioCell;
}

const UNASSIGNED = "—";
const empty = (): PortfolioCell => ({ usd: 0, weighted: 0, count: 0 });
function add(c: PortfolioCell, o: PortfolioOpp) { c.usd += o.amountUsd ?? 0; c.weighted += o.weighted; c.count += 1; }

const rowValue = (o: PortfolioOpp, dim: RowDim): string => (dim === "partner" ? o.partner : dim === "vendor" ? o.vendor : dim === "territory" ? o.territory : o.seller) ?? UNASSIGNED;
const colValue = (o: PortfolioOpp, dim: ColDim): string => (dim === "condition" ? o.condition : dim === "stage" ? o.stage : o.partner ?? UNASSIGNED);

/** Which dimensions actually have data (non-null on ≥1 open opp) — the caller offers only these. */
export function availableDims(opps: PortfolioOpp[]): { rows: RowDim[]; cols: ColDim[] } {
  const open = opps.filter((o) => !o.closed);
  const has = (f: (o: PortfolioOpp) => string | null) => open.some((o) => f(o) != null);
  const rows: RowDim[] = [];
  if (has((o) => o.partner)) rows.push("partner");
  if (has((o) => o.vendor)) rows.push("vendor");
  if (has((o) => o.territory)) rows.push("territory");
  if (has((o) => o.seller)) rows.push("seller");
  const cols: ColDim[] = ["condition", "stage"];
  if (has((o) => o.partner)) cols.push("partner");
  return { rows, cols };
}

/** Column key ordering: conditions in severity order, stages in the caller-provided order, else A→Z. */
function orderCols(colDim: ColDim, keys: Set<string>, stageOrder: string[]): string[] {
  const arr = [...keys];
  if (colDim === "condition") {
    const rank: Record<string, number> = { at_risk: 0, stalling: 1, healthy: 2, closed: 3 };
    return arr.sort((a, b) => (rank[a] ?? 9) - (rank[b] ?? 9));
  }
  if (colDim === "stage") return arr.sort((a, b) => stageOrder.indexOf(a) - stageOrder.indexOf(b));
  return arr.sort((a, b) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)));
}

export function buildPortfolio(opps: PortfolioOpp[], rowDim: RowDim, colDim: ColDim, stageOrder: string[] = []): Portfolio {
  // Portfolio is a picture of the OPEN book (closed deals are outcomes, not exposure to concentrate).
  const open = opps.filter((o) => !o.closed);
  const rowMap = new Map<string, PortfolioRow>();
  const colKeySet = new Set<string>();
  const totals: Record<string, PortfolioCell> = {};
  const grandTotal = empty();

  for (const o of open) {
    const rk = rowValue(o, rowDim);
    const ck = colValue(o, colDim);
    colKeySet.add(ck);
    let row = rowMap.get(rk);
    if (!row) { row = { key: rk, cells: {}, total: empty() }; rowMap.set(rk, row); }
    if (!row.cells[ck]) row.cells[ck] = empty();
    add(row.cells[ck], o);
    add(row.total, o);
    if (!totals[ck]) totals[ck] = empty();
    add(totals[ck], o);
    add(grandTotal, o);
  }

  const colKeys = orderCols(colDim, colKeySet, stageOrder);
  const rows = [...rowMap.values()].sort((a, b) => b.total.weighted - a.total.weighted);
  return { rowDim, colDim, colKeys, rows, totals, grandTotal };
}
