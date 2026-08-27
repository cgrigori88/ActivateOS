"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BandBadge } from "@/components/ui";

/**
 * Selectable + filterable account table (#3). The user filters by column
 * fields, picks one or many accounts, and acts on the selection — create a
 * target list, or have the AI draft motions. Selection state is client-side;
 * the chosen ids are submitted to server actions via a hidden field.
 */

export interface SelAccount {
  companyId: string;
  name: string;
  industry: string | null;
  score: number | null;
  band: string | null;
  partners: string[];
  partnerCount: number;
  motion: string;
  hasMotion: boolean;
}

const BANDS = ["all", "very_high", "high", "medium", "low"];

export function SelectableAccounts({
  accounts,
  createTarget,
  generateMotions,
}: {
  accounts: SelAccount[];
  createTarget: (fd: FormData) => Promise<void>;
  generateMotions: (fd: FormData) => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [band, setBand] = useState("all");
  const [motion, setMotion] = useState("all");

  const filtered = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (band === "all" || a.band === band) &&
          (motion === "all" || a.motion === motion) &&
          (!q || a.name.toLowerCase().includes(q.toLowerCase()) || (a.industry ?? "").toLowerCase().includes(q.toLowerCase())),
      ),
    [accounts, q, band, motion],
  );

  const allSelected = filtered.length > 0 && filtered.every((a) => sel.has(a.companyId));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSel((s) => {
      const n = new Set(s);
      if (allSelected) filtered.forEach((a) => n.delete(a.companyId));
      else filtered.forEach((a) => n.add(a.companyId));
      return n;
    });

  const ids = [...sel].join(",");
  const input = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div>
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account / industry" className={`${input} w-56`} />
        <select value={band} onChange={(e) => setBand(e.target.value)} className={input}>
          {BANDS.map((b) => <option key={b} value={b}>{b === "all" ? "Any propensity" : b.replace(/_/g, " ")}</option>)}
        </select>
        <select value={motion} onChange={(e) => setMotion(e.target.value)} className={input}>
          <option value="all">Any motion</option>
          <option value="cross-sell / upsell">Cross-sell / upsell</option>
          <option value="net-new">Net-new</option>
        </select>
        <span className="ml-auto text-xs text-neutral-500">{filtered.length} shown · {sel.size} selected</span>
      </div>

      {/* Action bar (appears with a selection) */}
      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <span className="text-sm font-medium">{sel.size} account{sel.size === 1 ? "" : "s"} selected</span>
          <form action={createTarget} className="flex items-end gap-2">
            <input type="hidden" name="companyIds" value={ids} />
            <input name="name" defaultValue="Selected accounts" className={`${input} w-44`} />
            <button className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">Create target list</button>
          </form>
          <form action={generateMotions}>
            <input type="hidden" name="companyIds" value={ids} />
            <button className="rounded-md border border-blue-300 px-3 py-1.5 text-sm font-medium text-accent hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900">
              Generate motions (AI)
            </button>
          </form>
          <button type="button" onClick={() => setSel(new Set())} className="text-xs text-neutral-500 hover:underline">clear</button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" /></th>
              <th>Account</th>
              <th className="text-right">Propensity</th>
              <th>Partners</th>
              <th>Motion</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.companyId} className={sel.has(a.companyId) ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}>
                <td><input type="checkbox" checked={sel.has(a.companyId)} onChange={() => toggle(a.companyId)} className="h-4 w-4" /></td>
                <td>
                  <Link href={`/accounts/${a.companyId}`} className="font-medium hover:underline">{a.name}</Link>
                  {a.industry && <div className="text-label text-neutral-400">{a.industry}</div>}
                </td>
                <td className="text-right">
                  {a.score == null ? <span className="text-neutral-400">—</span> : (
                    <span className="inline-flex items-center gap-2"><span className="tnum font-semibold">{a.score.toFixed(0)}</span>{a.band && <BandBadge band={a.band} />}</span>
                  )}
                </td>
                <td>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300">{a.partners.join(", ")}</span>
                  {a.partnerCount >= 2 && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">×{a.partnerCount}</span>}
                </td>
                <td className="text-xs text-neutral-500">{a.motion}</td>
                <td className="text-right text-label text-neutral-400">{a.hasMotion ? "has motion" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
