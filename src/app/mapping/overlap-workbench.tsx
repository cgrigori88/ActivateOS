"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BandBadge, buttonClass } from "@/components/ui";

/**
 * Overlap workbench — the consolidated overlap / coverage / targets surface.
 * Rows are co-sell accounts, columns are partners (the same row×column shape as
 * the account-mapping matrix), enriched with what the flat views couldn't say:
 *  - the REAL suggested play (an active play template with its objective + CTA),
 *    not the list category it came from
 *  - WHY the propensity is what it is (top scoring dimensions + latest verified
 *    signal), one chevron away
 *  - channel conflict, made explicit: 2+ partners actively claiming the account
 *  - selection → a NAMED list → AI-drafted motions, without leaving the screen
 */

export interface OverlapPartnerMark {
  onList: boolean;
  categories: string[];
  claims: boolean; // partner lists it as their customer / open opportunity
}

export interface OverlapRow {
  companyId: string;
  name: string;
  domain: string | null;
  score: number | null;
  band: string | null;
  motion: string; // cross-sell / upsell | net-new
  conflict: boolean;
  marks: Record<string, OverlapPartnerMark>; // partnerId → mark
  play: { name: string; solution: string; objective: string | null; offer: string | null } | null;
  why: { drivers: { dim: string; value: number }[]; signal: string | null; delta: number | null };
  hasMotion: boolean;
}

/** Who is claiming this account, and on what basis — the conflict, in words. */
function claimantSummary(
  r: OverlapRow,
  partners: { id: string; name: string }[],
): { short: string; full: string } {
  const claimants = partners
    .filter((p) => r.marks[p.id]?.claims)
    .map((p) => ({
      first: p.name.split(" ")[0],
      full: `${p.name} (${(r.marks[p.id].categories.join(", ") || "claims it")})`,
    }));
  return {
    short: claimants.map((c) => c.first).join(" × "),
    full: claimants.map((c) => c.full).join(" and "),
  };
}

const BANDS = ["all", "very_high", "high", "medium", "low"];
const input = "rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900";

export function OverlapWorkbench({
  rows,
  partners,
  createTarget,
  generateMotions,
}: {
  rows: OverlapRow[];
  partners: { id: string; name: string; type: string | null }[];
  createTarget: (fd: FormData) => Promise<void>;
  generateMotions: (fd: FormData) => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [partner, setPartner] = useState("all");
  const [band, setBand] = useState("all");
  const [motion, setMotion] = useState("all");
  const [conflictOnly, setConflictOnly] = useState(false);
  const [sort, setSort] = useState<"score" | "partners" | "name">("score");

  const filtered = useMemo(() => {
    const f = rows.filter(
      (r) =>
        (partner === "all" || r.marks[partner]?.onList) &&
        (band === "all" || r.band === band) &&
        (motion === "all" || r.motion === motion) &&
        (!conflictOnly || r.conflict) &&
        (!q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.domain ?? "").toLowerCase().includes(q.toLowerCase())),
    );
    return [...f].sort((a, b) =>
      sort === "score"
        ? (b.score ?? -1) - (a.score ?? -1)
        : sort === "partners"
          ? Object.values(b.marks).filter((m) => m.onList).length - Object.values(a.marks).filter((m) => m.onList).length
          : a.name.localeCompare(b.name),
    );
  }, [rows, q, partner, band, motion, conflictOnly, sort]);

  const allSelected = filtered.length > 0 && filtered.every((r) => sel.has(r.companyId));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allSelected) filtered.forEach((r) => n.delete(r.companyId)); else filtered.forEach((r) => n.add(r.companyId)); return n; });
  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const ids = [...sel].join(",");
  const conflicts = rows.filter((r) => r.conflict).length;

  return (
    <div>
      {/* Filters + sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account / domain" className={`${input} w-52`} />
        <select value={partner} onChange={(e) => setPartner(e.target.value)} className={input}>
          <option value="all">Any partner</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={band} onChange={(e) => setBand(e.target.value)} className={input}>
          {BANDS.map((b) => <option key={b} value={b}>{b === "all" ? "Any propensity" : b.replace(/_/g, " ")}</option>)}
        </select>
        <select value={motion} onChange={(e) => setMotion(e.target.value)} className={input}>
          <option value="all">Any motion</option>
          <option value="cross-sell / upsell">Cross-sell / upsell</option>
          <option value="net-new">Net-new</option>
        </select>
        <button
          type="button"
          onClick={() => setConflictOnly((v) => !v)}
          className={`rounded-control px-2.5 py-1.5 text-body font-medium ring-1 ring-inset ${conflictOnly ? "bg-amber-600 text-white ring-amber-600" : "text-amber-700 ring-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:ring-amber-800 dark:hover:bg-amber-950"}`}
        >
          ⚠ conflicts {conflicts}
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${input} ml-auto`}>
          <option value="score">Sort: propensity</option>
          <option value="partners">Sort: partner count</option>
          <option value="name">Sort: name</option>
        </select>
        <span className="text-body text-neutral-500">{filtered.length} shown · {sel.size} selected</span>
      </div>

      {/* Action bar — name the list, then act on it */}
      {sel.size > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-inner border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <span className="text-copy font-medium">{sel.size} account{sel.size === 1 ? "" : "s"} selected</span>
          <form action={createTarget} className="flex items-end gap-2">
            <input type="hidden" name="companyIds" value={ids} />
            <input type="hidden" name="source" value="web" />
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">List name (feeds motions &amp; campaigns)</span>
              <input name="name" placeholder="e.g. East co-sell wave 1" className={`${input} w-56`} />
            </label>
            <button className={buttonClass("primary", "sm")}>Create named list</button>
          </form>
          <form action={generateMotions}>
            <input type="hidden" name="companyIds" value={ids} />
            <button className={buttonClass("primary", "sm")}>
              Draft motions (AI)
            </button>
          </form>
          <button type="button" onClick={() => setSel(new Set())} className="text-body text-neutral-500 hover:underline">clear</button>
        </div>
      )}

      {/* Account × partner grid + motion/play/propensity */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" /></th>
              <th>Account</th>
              {partners.map((p) => (
                <th key={p.id} className="text-center" title={p.type ?? "partner"}>{p.name}</th>
              ))}
              <th>Motion</th>
              <th>Suggested play</th>
              <th className="text-right">Propensity</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const open = expanded.has(r.companyId);
              const nCols = partners.length + 6;
              return (
                <FragmentRow
                  key={r.companyId}
                  r={r}
                  partners={partners}
                  open={open}
                  nCols={nCols}
                  selected={sel.has(r.companyId)}
                  onToggle={() => toggle(r.companyId)}
                  onExpand={() => toggleExpand(r.companyId)}
                />
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-neutral-100 px-3 py-2 text-label text-neutral-500 dark:border-neutral-800">
          ● on the partner&apos;s list · ◆ the partner claims it (their customer / open opp) · ⚠ 2+ partners claim it — resolve who leads via deal registration
        </p>
      </div>
    </div>
  );
}

function FragmentRow({
  r,
  partners,
  open,
  nCols,
  selected,
  onToggle,
  onExpand,
}: {
  r: OverlapRow;
  partners: { id: string; name: string; type: string | null }[];
  open: boolean;
  nCols: number;
  selected: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  return (
    <>
      <tr className={selected ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}>
        <td><input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4" /></td>
        <td>
          <span className="flex items-center gap-1.5">
            <Link href={`/accounts/${r.companyId}`} className="font-medium hover:underline">{r.name}</Link>
            {r.conflict && (
              <span
                className="rounded-inner bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                title={`Channel conflict — both actively claim this account: ${claimantSummary(r, partners).full}`}
              >
                ⚠ {claimantSummary(r, partners).short}
              </span>
            )}
          </span>
          {r.domain && <div className="text-label text-neutral-400">{r.domain}</div>}
        </td>
        {partners.map((p) => {
          const m = r.marks[p.id];
          return (
            <td key={p.id} className="text-center">
              {m?.onList ? (
                <span
                  title={`${p.name}: ${m.categories.join(", ") || "on list"}${m.claims ? " · claims the account" : ""}`}
                  className={m.claims ? "text-sky-600 dark:text-sky-400" : "text-green-600 dark:text-green-400"}
                >
                  {m.claims ? "◆" : "●"}
                </span>
              ) : (
                <span className="text-neutral-300 dark:text-neutral-700">·</span>
              )}
            </td>
          );
        })}
        <td>
          <span className={`inline-flex rounded-control px-2 py-0.5 text-body font-medium ring-1 ring-inset ${r.motion === "net-new" ? "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300" : "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300"}`}>
            {r.motion}
          </span>
        </td>
        <td className="text-body">
          {r.play ? (
            <button type="button" onClick={onExpand} className={buttonClass("subtle", "md")}>
              {r.play.name}
            </button>
          ) : (
            <span className="text-neutral-400">score to suggest</span>
          )}
          {r.hasMotion && <span className="ml-1 text-micro text-neutral-400">· has motion</span>}
        </td>
        <td className="text-right">
          {r.score == null ? <span className="text-neutral-400">—</span> : (
            <span className="inline-flex items-center gap-2">
              <span className="tnum font-semibold">{r.score.toFixed(0)}</span>
              {r.band && <BandBadge band={r.band} />}
            </span>
          )}
        </td>
        <td>
          <button type="button" onClick={onExpand} aria-label="Details" className={`text-neutral-400 transition-transform hover:text-neutral-700 dark:hover:text-neutral-200 ${open ? "rotate-90" : ""}`}>▸</button>
        </td>
      </tr>
      {open && (
        <tr className="bg-neutral-50/60 dark:bg-neutral-900/60">
          <td></td>
          <td colSpan={nCols - 1} className="py-3">
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Why this propensity */}
              <div>
                <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-neutral-400">Why {r.score != null ? `propensity ${r.score.toFixed(0)}` : "unscored"}</p>
                {r.why.drivers.length > 0 ? (
                  <ul className="space-y-1">
                    {r.why.drivers.map((d) => (
                      <li key={d.dim} className="flex items-center gap-2 text-body">
                        <span className="w-36 shrink-0 text-neutral-500">{d.dim.replace(/_/g, " ")}</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                          <span className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, d.value)}%` }} />
                        </span>
                        <span className="tnum text-neutral-500">{Math.round(d.value)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-neutral-400">No score yet — run scoring to see drivers.</p>
                )}
                {r.why.delta != null && r.why.delta !== 0 && (
                  <p className={`mt-1 text-label font-medium ${r.why.delta > 0 ? "text-positive dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {r.why.delta > 0 ? "+" : ""}{r.why.delta} since last scoring
                  </p>
                )}
                {r.why.signal && (
                  <p className="mt-2 text-body text-neutral-600 dark:text-neutral-300">
                    <span className="font-medium">Latest verified signal:</span> {r.why.signal}
                  </p>
                )}
              </div>

              {/* The actual play */}
              <div>
                <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-neutral-400">Suggested play</p>
                {r.play ? (
                  <>
                    <p className="text-copy font-medium">{r.play.name}</p>
                    <p className="text-label text-neutral-400">solution: {r.play.solution}</p>
                    {r.play.objective && <p className="mt-1 text-body leading-relaxed text-neutral-600 dark:text-neutral-300">{r.play.objective}</p>}
                    {r.play.offer && <p className="mt-1 text-body text-neutral-500"><span className="font-medium">CTA:</span> {r.play.offer}</p>}
                  </>
                ) : (
                  <p className="text-body text-neutral-400">Score the account to map it to an active play.</p>
                )}
              </div>

              {/* Which partner lists it sits on */}
              <div>
                <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-neutral-400">Partner coverage</p>
                <ul className="space-y-1">
                  {partners.filter((p) => r.marks[p.id]?.onList).map((p) => {
                    const m = r.marks[p.id];
                    return (
                      <li key={p.id} className="text-body text-neutral-600 dark:text-neutral-300">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-neutral-400"> {p.type ? `(${p.type})` : ""} — {m.categories.join(", ") || "on list"}{m.claims ? " · claims the account" : ""}</span>
                      </li>
                    );
                  })}
                </ul>
                {r.conflict && (
                  <p className="mt-2 rounded-control bg-amber-50 px-2 py-1.5 text-label text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    ⚠ <span className="font-semibold">Channel conflict:</span> {claimantSummary(r, partners).full} both
                    claim this account — the same deal could be worked twice, or partners could undercut each other in
                    front of the customer. Decide who leads and lock it with a deal registration on the opportunity.
                  </p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
