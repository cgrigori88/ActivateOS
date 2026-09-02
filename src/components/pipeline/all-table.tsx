"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CONDITION_LABEL, type ConditionState } from "@/lib/opportunities/condition";
import { formatMoney } from "@/lib/format/money";

/**
 * Pipeline All (scale-disclosure §3.3 / R5). The exhaustive open+closed book as ONE dense,
 * sortable, filterable table — not an arbitrarily long card stack. Client-side sort/filter over
 * the already-scoped rows; every field stays reachable, presentation changes, not capability. A
 * lightweight windowing cap keeps thousands of rows responsive with an explicit "show more".
 */

export interface AllRow {
  id: string;
  name: string;
  account: string;
  companyId: string;
  stage: string;
  amountUsd: number | null;
  weightedUsd: number | null;
  partner: string | null;
  condition: ConditionState;
  closeDate: string | null;
  meddpicc: number;
}

type SortKey = "account" | "stage" | "amountUsd" | "weightedUsd" | "meddpicc" | "closeDate";
const PAGE = 100;
const k = (n: number | null) => formatMoney(n);
const condTone: Record<ConditionState, string> = {
  at_risk: "var(--color-accent-risk)", stalling: "var(--color-accent-attention)", healthy: "var(--color-route)", closed: "var(--color-neutral-400)",
};

export function PipelineAllTable({ rows, drawerBase }: { rows: AllRow[]; drawerBase?: string }) {
  const drawerHref = (companyId: string) => {
    const p = new URLSearchParams(drawerBase ?? "");
    p.set("drawer", companyId);
    return `/pipeline?${p.toString()}`;
  };
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("weightedUsd");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (needle) list = rows.filter((r) => r.account.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || (r.partner ?? "").toLowerCase().includes(needle));
    const val = (r: AllRow): number | string => {
      switch (sort) {
        case "account": return r.account.toLowerCase();
        case "stage": return r.stage;
        case "amountUsd": return r.amountUsd ?? -1;
        case "weightedUsd": return r.weightedUsd ?? -1;
        case "meddpicc": return r.meddpicc;
        case "closeDate": return r.closeDate ?? "";
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, q, sort, dir]);

  const shown = filtered.slice(0, limit);
  const onSort = (key: SortKey) => {
    if (key === sort) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(key); setDir(key === "account" || key === "stage" ? 1 : -1); }
  };
  const Th = ({ label, k: key, right }: { label: string; k: SortKey; right?: boolean }) => (
    <th className={`px-3 py-2 font-semibold text-neutral-500 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(key)} className="inline-flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200">
        {label}{sort === key && <span className="text-micro">{dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Filter by account, opportunity, or partner…"
          className="w-full max-w-sm rounded-inner border bg-transparent px-3 py-1.5 text-copy outline-none placeholder:text-neutral-400" style={{ borderColor: "var(--border-subtle)" }} />
        <span className="text-label text-neutral-400">{filtered.length} row{filtered.length === 1 ? "" : "s"}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border scroll-thin" style={{ borderColor: "var(--border-subtle)" }}>
        <table className="w-full border-collapse text-copy">
          <thead>
            <tr style={{ background: "var(--surface-inset)" }}>
              <Th label="Account · opportunity" k="account" />
              <Th label="Stage" k="stage" />
              <th className="px-3 py-2 text-left font-semibold text-neutral-500">Condition</th>
              <Th label="Amount" k="amountUsd" right />
              <Th label="Weighted" k="weightedUsd" right />
              <Th label="MEDDPICC" k="meddpicc" right />
              <th className="px-3 py-2 text-left font-semibold text-neutral-500">Partner</th>
              <Th label="Close" k="closeDate" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const closed = r.stage.startsWith("closed");
              return (
                <tr key={r.id} className="border-t hover:bg-[var(--surface-inset)]" style={{ borderColor: "var(--border-subtle)" }}>
                  <td className="px-3 py-1.5">
                    <Link href={drawerHref(r.companyId)} scroll={false} className="font-medium hover:underline" title="Open account intelligence">{r.account}</Link>
                    <span className="ml-1.5 text-label text-neutral-400">{r.name}</span>
                  </td>
                  <td className="px-3 py-1.5 text-body uppercase tracking-wide text-neutral-500">{r.stage.replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5">
                    {closed ? <span className="text-label text-neutral-400">—</span> : (
                      <span className="inline-flex items-center gap-1 text-label font-medium" style={{ color: condTone[r.condition] }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: condTone[r.condition] }} />{CONDITION_LABEL[r.condition]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tnum">{k(r.amountUsd)}</td>
                  <td className="px-3 py-1.5 text-right tnum text-neutral-500">{k(r.weightedUsd)}</td>
                  <td className="px-3 py-1.5 text-right tnum">
                    <span style={{ color: r.meddpicc >= 70 ? "var(--color-accent-verified)" : r.meddpicc >= 40 ? "var(--color-accent-attention)" : "var(--color-accent-risk)" }}>{r.meddpicc}</span>
                  </td>
                  <td className="px-3 py-1.5 text-body text-neutral-500">{r.partner ?? "—"}</td>
                  <td className="px-3 py-1.5 text-body text-neutral-500">{r.closeDate ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > shown.length && (
        <div className="mt-2 text-center">
          <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="rounded-inner px-4 py-1.5 text-body font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900">
            Show {Math.min(PAGE, filtered.length - shown.length)} more · {filtered.length - shown.length} remaining
          </button>
        </div>
      )}
    </div>
  );
}
