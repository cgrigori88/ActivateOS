import Link from "next/link";
import { CONDITION_LABEL } from "@/lib/opportunities/condition";
import type { Portfolio, RowDim, ColDim } from "@/lib/opportunities/portfolio";

/**
 * Pipeline Portfolio matrix (scale-disclosure §3.2 / R4). An ecosystem-native pivot: weighted $ +
 * count per {row dimension × column dimension} over the open book. Row/column dimension pickers
 * offer only dimensions the data supports (empty ones are absent, never synthesized). Every cell
 * drills into the underlying reconciled records (Attention, filtered) under the current scope.
 */

const ROW_LABEL: Record<RowDim, string> = { partner: "Partner", vendor: "Vendor", territory: "Territory", seller: "Seller" };
const COL_LABEL: Record<ColDim, string> = { condition: "Condition", stage: "Stage", partner: "Partner" };
const colKeyLabel = (colDim: ColDim, key: string): string =>
  colDim === "condition" ? (CONDITION_LABEL[key as keyof typeof CONDITION_LABEL] ?? key) : key.replace(/_/g, " ");
const k = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : n ? `$${Math.round(n)}` : "—");

export function PortfolioMatrix({
  portfolio, rows, cols, basePath, scopeToken,
}: { portfolio: Portfolio; rows: RowDim[]; cols: ColDim[]; basePath: string; scopeToken?: string | undefined }) {
  const { rowDim, colDim, colKeys, totals, grandTotal } = portfolio;
  const maxWeighted = Math.max(1, ...portfolio.rows.flatMap((r) => colKeys.map((c) => r.cells[c]?.weighted ?? 0)));

  const dimHref = (which: "prow" | "pcol", value: string) => {
    const p = new URLSearchParams();
    p.set("view", "portfolio");
    p.set("prow", which === "prow" ? value : rowDim);
    p.set("pcol", which === "pcol" ? value : colDim);
    if (scopeToken) p.set("scope", scopeToken);
    return `${basePath}?${p.toString()}`;
  };
  // Drill-in: a cell → Attention filtered to that slice (partner + condition where they map cleanly).
  const cellHref = (rowKey: string, colKey: string): string | null => {
    const p = new URLSearchParams();
    p.set("view", "attention");
    if (scopeToken) p.set("scope", scopeToken);
    if (rowDim === "partner" && rowKey !== "—") p.set("partner", rowKey);
    if (colDim === "partner" && colKey !== "—") p.set("partner", colKey);
    if (colDim === "condition") p.set("cond", colKey);
    if (colDim === "stage") p.set("stage", colKey);
    // Attention only surfaces at-risk/stalling; a healthy/other slice has nothing to intervene on.
    if (colDim === "condition" && colKey === "healthy") return null;
    return `${basePath}?${p.toString()}`;
  };

  const cellBg = (weighted: number) => `color-mix(in srgb, var(--color-priority) ${Math.round((weighted / maxWeighted) * 22)}%, transparent)`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
        <span className="flex items-center gap-1.5">
          <span className="text-neutral-400">Rows</span>
          {rows.map((r) => (
            <Link key={r} href={dimHref("prow", r)} className={`rounded-full px-2 py-0.5 font-medium ${r === rowDim ? "bg-accent text-white" : "text-neutral-500 ring-1 ring-inset ring-neutral-300 hover:ring-neutral-400 dark:ring-neutral-700"}`}>{ROW_LABEL[r]}</Link>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-neutral-400">Columns</span>
          {cols.filter((c) => (c as string) !== (rowDim as string)).map((c) => (
            <Link key={c} href={dimHref("pcol", c)} className={`rounded-full px-2 py-0.5 font-medium ${c === colDim ? "bg-accent text-white" : "text-neutral-500 ring-1 ring-inset ring-neutral-300 hover:ring-neutral-400 dark:ring-neutral-700"}`}>{COL_LABEL[c]}</Link>
          ))}
        </span>
        <span className="ml-auto text-label text-neutral-400">weighted exposure · click a cell to drill in</span>
      </div>

      {portfolio.rows.length === 0 ? (
        <p className="rounded-card p-4 text-sm text-neutral-500" style={{ background: "var(--surface-inset)" }}>No open opportunities in this scope.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border scroll-thin" style={{ borderColor: "var(--border-subtle)" }}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left" style={{ background: "var(--surface-inset)" }}>
                <th className="px-3 py-2 font-semibold text-neutral-500">{ROW_LABEL[rowDim]}</th>
                {colKeys.map((c) => (
                  <th key={c} className="px-3 py-2 text-right font-semibold capitalize text-neutral-500">{colKeyLabel(colDim, c)}</th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-neutral-600 dark:text-neutral-300">Total</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.rows.map((row) => (
                <tr key={row.key} className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
                  <td className="px-3 py-2 font-medium">{row.key}</td>
                  {colKeys.map((c) => {
                    const cell = row.cells[c];
                    const href = cell && cell.count > 0 ? cellHref(row.key, c) : null;
                    const inner = cell && cell.count > 0 ? (
                      <>
                        <span className="tnum font-semibold">{k(cell.weighted)}</span>
                        <span className="ml-1 text-[10.5px] text-neutral-400">·{cell.count}</span>
                      </>
                    ) : <span className="text-neutral-300 dark:text-neutral-600">—</span>;
                    return (
                      <td key={c} className="px-3 py-1.5 text-right" style={cell && cell.weighted > 0 ? { background: cellBg(cell.weighted) } : undefined}>
                        {href ? <Link href={href} className="inline-block rounded px-1 hover:underline">{inner}</Link> : inner}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tnum font-bold">{k(row.total.weighted)}</td>
                </tr>
              ))}
              <tr className="border-t-2" style={{ borderColor: "var(--border-strong,var(--border-subtle))", background: "var(--surface-inset)" }}>
                <td className="px-3 py-2 font-bold text-neutral-600 dark:text-neutral-300">Total</td>
                {colKeys.map((c) => (
                  <td key={c} className="px-3 py-2 text-right tnum font-semibold text-neutral-600 dark:text-neutral-300">{k(totals[c]?.weighted ?? 0)}</td>
                ))}
                <td className="px-3 py-2 text-right tnum font-extrabold">{k(grandTotal.weighted)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
