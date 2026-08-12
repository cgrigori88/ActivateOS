import Link from "next/link";
import { getPool } from "@/db/client";
import { BandBadge, Card, PageHeader } from "@/components/ui";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  availableFields,
  intersection,
  listPopulations,
  matrix,
  partnersWithPopulations,
  type Category,
  type Population,
} from "@/lib/mapping/populations";
import { createPopulationAction, setPopulationStatusAction, targetFromCellAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Mapping (Phase 8): where the SAME account shows up across a reseller, a
 * distributor and a vendor — the overlap that founds a co-sell campaign. Three
 * lenses: overlap + motion, coverage/conflict grid, and propensity-ranked
 * shared targets.
 */

type View = "matrix" | "overlap" | "coverage" | "targets";
const VIEWS: { key: View; label: string }[] = [
  { key: "matrix", label: "Account mapping" },
  { key: "overlap", label: "Overlap + motion" },
  { key: "coverage", label: "Coverage & conflict" },
  { key: "targets", label: "Ranked targets" },
];

function ViewTabs({ view }: { view: View }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {VIEWS.map((v) => (
        <Link
          key={v.key}
          href={`/mapping?view=${v.key}`}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            view === v.key
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
          }`}
        >
          {v.label}
        </Link>
      ))}
    </div>
  );
}

interface FlatRow {
  company_id: string;
  legal_name: string;
  primary_domain: string | null;
  partner_id: string;
  partner: string;
  partner_type: string | null;
  installed: boolean;
  target_product: string | null;
  score: string | null;
  band: string | null;
}

interface Grouped {
  companyId: string;
  name: string;
  domain: string | null;
  partners: { id: string; name: string; type: string | null; installed: boolean }[];
  anyInstalled: boolean;
  score: number | null;
  band: string | null;
  targets: string[];
}

function motion(anyInstalled: boolean): { label: string; tone: string } {
  return anyInstalled
    ? { label: "cross-sell / upsell", tone: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300" }
    : { label: "net-new", tone: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300" };
}

export default async function MappingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; partner?: string; row?: string; col?: string; cols?: string; hide?: string; notice?: string }>;
}) {
  const sp = await searchParams;
  const view: View = (["matrix", "overlap", "coverage", "targets"].includes(sp.view ?? "") ? sp.view : "matrix") as View;

  // ── Account-mapping matrix (Phase 10) ────────────────────────────────────
  if (view === "matrix") {
    return (
      <main>
        <PageHeader
          title="Account mapping"
          subtitle="Cross your populations with a partner's — every cell is the accounts you share, rolled up with propensity. Click a cell to drill in."
        />
        <ViewTabs view={view} />
        {sp.notice && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
            {sp.notice}
          </div>
        )}
        {sp.row && sp.col ? (
          <CellView rowId={sp.row} colId={sp.col} cols={sp.cols} partnerId={sp.partner} />
        ) : (
          <MatrixSection partnerId={sp.partner} hideEmpty={sp.hide === "1"} />
        )}
        <PopulationManager />
      </main>
    );
  }

  const partnerFilter = sp.partner;
  const pool = getPool();
  const { rows } = await pool.query<FlatRow>(
    `select c.id as company_id, c.legal_name, c.primary_domain,
            p.id as partner_id, p.name as partner, p.partner_type,
            pa.installed, pa.target_product,
            (select ps.score from propensity_scores ps where ps.company_id = c.id order by ps.computed_at desc limit 1) as score,
            (select ps.band from propensity_scores ps where ps.company_id = c.id order by ps.computed_at desc limit 1) as band
     from partner_accounts pa
     join companies c on c.id = pa.company_id
     join partners p on p.id = pa.partner_id
     where c.id in (
       select company_id from partner_accounts group by company_id having count(distinct partner_id) >= 2
     )
     order by c.legal_name, p.name`,
  );

  // Group flat (company × partner) rows into overlap records.
  const byCompany = new Map<string, Grouped>();
  const partnerCols = new Map<string, string>(); // id → name, for the coverage grid
  for (const r of rows) {
    partnerCols.set(r.partner_id, r.partner);
    let g = byCompany.get(r.company_id);
    if (!g) {
      g = {
        companyId: r.company_id,
        name: r.legal_name,
        domain: r.primary_domain,
        partners: [],
        anyInstalled: false,
        score: r.score == null ? null : Number(r.score),
        band: r.band,
        targets: [],
      };
      byCompany.set(r.company_id, g);
    }
    g.partners.push({ id: r.partner_id, name: r.partner, type: r.partner_type, installed: r.installed });
    if (r.installed) g.anyInstalled = true;
    if (r.target_product && !g.targets.includes(r.target_product)) g.targets.push(r.target_product);
  }
  let overlaps = [...byCompany.values()];
  if (partnerFilter) overlaps = overlaps.filter((o) => o.partners.some((p) => p.id === partnerFilter));

  const partnerList = [...partnerCols.entries()].map(([id, name]) => ({ id, name }));

  return (
    <main>
      <PageHeader
        title="Mapping"
        subtitle="Accounts covered by more than one partner — the overlap where co-sell, whitespace, and channel-conflict decisions get made."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/mapping?view=${v.key}${partnerFilter ? `&partner=${partnerFilter}` : ""}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === v.key
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
            }`}
          >
            {v.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-neutral-500">{overlaps.length} overlapping account(s)</span>
      </div>

      {overlaps.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            No overlapping accounts yet. Overlap appears once the same company is on two or more partners&apos; lists —
            upload a second partner&apos;s book on the <Link href="/intake" className="text-blue-700 hover:underline dark:text-blue-400">Intake</Link> page.
          </p>
        </Card>
      ) : view === "overlap" ? (
        <OverlapView overlaps={overlaps} />
      ) : view === "coverage" ? (
        <CoverageView overlaps={overlaps} partners={partnerList} />
      ) : (
        <TargetsView overlaps={overlaps} />
      )}
    </main>
  );
}

function PartnerChips({ partners }: { partners: Grouped["partners"] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {partners.map((p) => (
        <span
          key={p.id}
          title={`${p.type ?? "partner"}${p.installed ? " · installed base" : ""}`}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
            p.installed
              ? "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300"
              : "bg-neutral-50 text-neutral-600 ring-neutral-300/50 dark:bg-neutral-900 dark:text-neutral-400 dark:ring-neutral-700"
          }`}
        >
          {p.name}
        </span>
      ))}
    </span>
  );
}

function OverlapView({ overlaps }: { overlaps: Grouped[] }) {
  const sorted = [...overlaps].sort((a, b) => b.partners.length - a.partners.length || (b.score ?? -1) - (a.score ?? -1));
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
      <table className="data-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Partners</th>
            <th>Motion</th>
            <th>Play</th>
            <th className="text-right">Propensity</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => {
            const m = motion(o.anyInstalled);
            return (
              <tr key={o.companyId}>
                <td>
                  <Link href={`/accounts/${o.companyId}`} className="font-medium hover:underline">{o.name}</Link>
                  {o.domain && <div className="text-[11px] text-neutral-400">{o.domain}</div>}
                </td>
                <td><PartnerChips partners={o.partners} /></td>
                <td>
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.tone}`}>{m.label}</span>
                </td>
                <td className="text-neutral-500 text-xs">{o.targets.join(", ") || "—"}</td>
                <td className="text-right">
                  {o.score == null ? <span className="text-neutral-400">—</span> : (
                    <span className="inline-flex items-center gap-2">
                      <span className="tnum font-semibold">{o.score.toFixed(0)}</span>
                      {o.band && <BandBadge band={o.band} />}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CoverageView({ overlaps, partners }: { overlaps: Grouped[]; partners: { id: string; name: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
      <table className="data-table">
        <thead>
          <tr>
            <th>Account</th>
            {partners.map((p) => (
              <th key={p.id} className="text-center">{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {overlaps.map((o) => {
            const cover = new Map(o.partners.map((p) => [p.id, p.installed]));
            return (
              <tr key={o.companyId}>
                <td>
                  <Link href={`/accounts/${o.companyId}`} className="font-medium hover:underline">{o.name}</Link>
                </td>
                {partners.map((p) => {
                  const has = cover.has(p.id);
                  const installed = cover.get(p.id);
                  return (
                    <td key={p.id} className="text-center">
                      {has ? (
                        <span
                          title={installed ? "on list · installed base" : "on list"}
                          className={installed ? "text-sky-600 dark:text-sky-400" : "text-green-600 dark:text-green-400"}
                        >
                          {installed ? "◆" : "●"}
                        </span>
                      ) : (
                        <span className="text-neutral-300 dark:text-neutral-700">·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-500 dark:border-neutral-800">
        ● on the partner&apos;s list · ◆ installed base (expand/cross-sell) · more partners on a row = more channel overlap
      </p>
    </div>
  );
}

function TargetsView({ overlaps }: { overlaps: Grouped[] }) {
  const ranked = [...overlaps].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
      <table className="data-table">
        <thead>
          <tr>
            <th className="text-right">Propensity</th>
            <th>Account</th>
            <th>Partners</th>
            <th>Motion</th>
            <th>Play</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((o) => {
            const m = motion(o.anyInstalled);
            return (
              <tr key={o.companyId}>
                <td className="text-right">
                  {o.score == null ? <span className="text-neutral-400">—</span> : (
                    <span className="inline-flex items-center gap-2">
                      <span className="tnum font-semibold">{o.score.toFixed(0)}</span>
                      {o.band && <BandBadge band={o.band} />}
                    </span>
                  )}
                </td>
                <td>
                  <Link href={`/accounts/${o.companyId}`} className="font-medium hover:underline">{o.name}</Link>
                </td>
                <td><PartnerChips partners={o.partners} /></td>
                <td>
                  <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.tone}`}>{m.label}</span>
                </td>
                <td className="text-neutral-500 text-xs">{o.targets.join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Account-mapping matrix components (Phase 10) ─────────────────────────────

async function soleOrgId(db: import("pg").PoolClient): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`);
  return rows[0]?.id ?? null;
}

const CAT_TONE: Record<string, string> = {
  customer: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  open_opportunity: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  prospect: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  target: "bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
};
function catTone(c: string): string {
  return CAT_TONE[c] ?? "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-300";
}

/** Subtle propensity heatmap — blue with alpha, legible on light and dark. */
function cellShade(avg: number | null): string | undefined {
  if (avg == null) return undefined;
  const alpha = Math.max(0.05, Math.min(0.3, 0.05 + (avg / 100) * 0.25));
  return `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
}

async function MatrixSection({ partnerId, hideEmpty }: { partnerId?: string; hideEmpty?: boolean }) {
  const pool = getPool();
  const db = await pool.connect();
  try {
    const orgId = await soleOrgId(db);
    if (!orgId) return <Card><p className="text-sm text-neutral-500">No organization yet.</p></Card>;

    const partners = await partnersWithPopulations(db, orgId);
    if (partners.length === 0) {
      return (
        <Card>
          <p className="text-sm text-neutral-500">
            No partner populations yet. Create populations for your side and a partner below, then the overlap matrix
            appears here — like Crossbeam&apos;s account mapping, scored by propensity.
          </p>
        </Card>
      );
    }
    const selected = partnerId && partners.some((p) => p.id === partnerId) ? partnerId : partners[0].id;
    const { rows: allRows, cols: allCols, cells, rowTotals, colTotals, kpi } = await matrix(db, { orgId, partnerId: selected });

    // Hide-empty drops rows/cols with no overlap at all.
    const rows = hideEmpty ? allRows.filter((r) => (rowTotals.get(r.id) ?? 0) > 0) : allRows;
    const cols = hideEmpty ? allCols.filter((c) => (colTotals.get(c.id) ?? 0) > 0) : allCols;
    const base = `/mapping?view=matrix&partner=${selected}`;

    const kpis: { label: string; value: string }[] = [
      { label: "overlapping accounts", value: kpi.accounts.toLocaleString() },
      { label: "high-propensity (hot)", value: kpi.hot.toLocaleString() },
      { label: "avg propensity", value: kpi.avg == null ? "—" : String(kpi.avg) },
    ];

    return (
      <>
        {/* KPI strip + partner picker */}
        <div className="mb-4 flex flex-wrap items-center gap-6">
          {kpis.map((k) => (
            <div key={k.label}>
              <div className="tnum text-2xl font-semibold">{k.value}</div>
              <div className="text-xs text-neutral-500">{k.label}</div>
            </div>
          ))}
          <div className="ml-auto flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">Partner</span>
              <div className="flex flex-wrap gap-1">
                {partners.map((p) => (
                  <Link
                    key={p.id}
                    href={`/mapping?view=matrix&partner=${p.id}${hideEmpty ? "&hide=1" : ""}`}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      p.id === selected
                        ? "bg-blue-700 text-white"
                        : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                    }`}
                  >
                    {p.name}
                  </Link>
                ))}
              </div>
            </div>
            <Link href={`${base}${hideEmpty ? "" : "&hide=1"}`} className="text-[11px] text-neutral-500 hover:underline">
              {hideEmpty ? "Show empty populations" : "Hide empty populations"}
            </Link>
          </div>
        </div>

        {rows.length === 0 || cols.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-500">
              {allRows.length === 0 || allCols.length === 0
                ? "Approve at least one population on each side to populate the matrix. Manage populations below."
                : "No overlaps to show with empty populations hidden."}
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-neutral-900">Your populations ↓ / Partner →</th>
                  <th className="text-center text-neutral-500">Total</th>
                  {cols.map((c) => (
                    <th key={c.id} className="text-center align-bottom">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-[10px] font-normal text-neutral-400">{CATEGORY_LABEL[c.category]}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="sticky left-0 z-10 bg-white dark:bg-neutral-900">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${catTone(r.category)}`}>
                        {r.name}
                      </span>
                      <div className="text-[10px] text-neutral-400">{r.members} accounts</div>
                    </td>
                    <td className="text-center tnum font-semibold text-neutral-500">{(rowTotals.get(r.id) ?? 0).toLocaleString()}</td>
                    {cols.map((c) => {
                      const cell = cells.get(`${r.id}:${c.id}`);
                      if (!cell || cell.count === 0) {
                        return <td key={c.id} className="text-center text-neutral-300 dark:text-neutral-700">None</td>;
                      }
                      return (
                        <td key={c.id} className="p-0 text-center" style={{ backgroundColor: cellShade(cell.avgScore) }}>
                          <Link
                            href={`${base}&row=${r.id}&col=${c.id}`}
                            className="flex flex-col items-center px-3 py-2.5 hover:ring-2 hover:ring-inset hover:ring-blue-500"
                          >
                            <span className="tnum text-lg font-semibold text-blue-800 dark:text-blue-300">{cell.count.toLocaleString()}</span>
                            <span className="text-[10px] text-neutral-600 dark:text-neutral-400">
                              {cell.avgScore != null ? `avg ${cell.avgScore.toFixed(0)}` : "—"}
                              {cell.highCount > 0 ? ` · ${cell.highCount} hot` : ""}
                            </span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Column totals */}
                <tr className="border-t-2 border-neutral-200 dark:border-neutral-700">
                  <td className="sticky left-0 z-10 bg-white text-xs font-semibold text-neutral-500 dark:bg-neutral-900">Total (distinct)</td>
                  <td className="text-center tnum font-bold">{kpi.accounts.toLocaleString()}</td>
                  {cols.map((c) => (
                    <td key={c.id} className="text-center tnum font-semibold text-neutral-500">{(colTotals.get(c.id) ?? 0).toLocaleString()}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-500 dark:border-neutral-800">
              Cell = accounts on both lists, shaded by avg propensity · hot = high/very-high band · Total = distinct
              accounts (a company on two columns counts once) · click a cell to drill in.
            </p>
          </div>
        )}
      </>
    );
  } finally {
    db.release();
  }
}

const BASE_COLS = ["industry", "employees", "propensity"];

async function CellView({ rowId, colId, cols, partnerId }: { rowId: string; colId: string; cols?: string; partnerId?: string }) {
  const pool = getPool();
  const db = await pool.connect();
  try {
    const { row, col, accounts } = await intersection(db, { rowPopId: rowId, colPopId: colId });
    const fields = await availableFields(db, { rowPopId: rowId, colPopId: colId });
    const selected = (cols ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const active = selected.length ? selected : BASE_COLS;
    const backHref = `/mapping?view=matrix${partnerId ? `&partner=${partnerId}` : ""}`;
    const cellBase = `/mapping?view=matrix${partnerId ? `&partner=${partnerId}` : ""}&row=${rowId}&col=${colId}`;

    const allToggles = [...BASE_COLS, ...fields];
    const toggleHref = (key: string) => {
      const next = active.includes(key) ? active.filter((k) => k !== key) : [...active, key];
      return `${cellBase}${next.length ? `&cols=${next.join(",")}` : ""}`;
    };

    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Link href={backHref} className="text-xs text-blue-700 hover:underline dark:text-blue-400">← Matrix</Link>
          <h2 className="text-base font-semibold">
            {row?.name ?? "?"} <span className="text-neutral-400">vs</span> {col?.name ?? "?"}
          </h2>
          <span className="text-xs text-neutral-500">{accounts.length} account(s)</span>

          {/* Mapping → targeting: turn this cell into a target list */}
          <details className="relative ml-auto">
            <summary className="cursor-pointer rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">
              Build target list
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <p className="mb-2 text-[11px] text-neutral-500">Creates an approved target population from these {accounts.length} accounts — ready to score, sequence, and campaign.</p>
              <form action={targetFromCellAction.bind(null, rowId, colId)} className="flex items-end gap-2">
                <input type="hidden" name="partner" value={partnerId ?? ""} />
                <input name="name" defaultValue={`${row?.name ?? ""} × ${col?.name ?? ""}`} className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
                <button className="shrink-0 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">Create</button>
              </form>
            </div>
          </details>

          <details className="relative">
            <summary className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">
              Columns
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-neutral-400">Toggle columns (from the data)</p>
              {allToggles.map((k) => (
                <Link
                  key={k}
                  href={toggleHref(k)}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 ${active.includes(k) ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}
                >
                  <span className={`inline-block h-3 w-3 rounded-sm border ${active.includes(k) ? "border-blue-600 bg-blue-600" : "border-neutral-300 dark:border-neutral-600"}`} />
                  {k.replace(/_/g, " ")}
                </Link>
              ))}
            </div>
          </details>
        </div>

        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Record</th>
                {active.map((k) => <th key={k} className="capitalize">{k.replace(/_/g, " ")}</th>)}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.company_id}>
                  <td>
                    <Link href={`/accounts/${a.company_id}`} className="font-medium hover:underline">{a.legal_name}</Link>
                    {a.primary_domain && <div className="text-[11px] text-neutral-400">{a.primary_domain}</div>}
                  </td>
                  {active.map((k) => {
                    if (k === "industry") return <td key={k} className="text-neutral-600 dark:text-neutral-300">{a.industry ?? "—"}</td>;
                    if (k === "employees") return <td key={k} className="tnum text-neutral-600 dark:text-neutral-300">{a.employee_count?.toLocaleString() ?? "—"}</td>;
                    if (k === "propensity") return (
                      <td key={k}>
                        {a.score == null ? <span className="text-neutral-400">—</span> : (
                          <span className="inline-flex items-center gap-2">
                            <span className="tnum font-semibold">{a.score.toFixed(0)}</span>
                            {a.band && <BandBadge band={a.band} />}
                          </span>
                        )}
                      </td>
                    );
                    const v = a.attributes?.[k];
                    return <td key={k} className="text-neutral-600 dark:text-neutral-300">{v == null || v === "" ? "—" : String(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } finally {
    db.release();
  }
}

async function PopulationManager() {
  const pool = getPool();
  const db = await pool.connect();
  try {
    const orgId = await soleOrgId(db);
    if (!orgId) return null;

    const { rows: partners } = await db.query<{ id: string; name: string }>(
      `select id, name from partners where org_id = $1 order by name`,
      [orgId],
    );
    const pending = await listPopulations(db, { orgId, partnerId: null, status: "pending" });
    const pendingPartner: Population[] = [];
    for (const p of partners) pendingPartner.push(...(await listPopulations(db, { orgId, partnerId: p.id, status: "pending" })));
    const allPending = [...pending, ...pendingPartner];

    const nameFor = (pid: string | null) => (pid ? partners.find((p) => p.id === pid)?.name ?? "Partner" : "Your side");

    return (
      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Populations</h2>

        {allPending.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-300">Pending approval — vet before they map</p>
            <div className="space-y-1.5">
              {allPending.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-neutral-500">{nameFor(p.partner_id)} · {CATEGORY_LABEL[p.category]} · {p.members} accounts</span>
                  <span className="ml-auto flex gap-1">
                    <form action={setPopulationStatusAction.bind(null, p.id, "approved")}>
                      <button className="text-xs font-medium text-green-700 hover:underline dark:text-green-400">approve</button>
                    </form>
                    <form action={setPopulationStatusAction.bind(null, p.id, "rejected")}>
                      <button className="text-xs font-medium text-red-700 hover:underline dark:text-red-400">reject</button>
                    </form>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form action={createPopulationAction} className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Name</span>
            <input name="name" placeholder="e.g. Corporate Territory East" className="w-52 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Category</span>
            <select name="category" defaultValue="customer" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              {(CATEGORIES as readonly Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Side</span>
            <select name="side" defaultValue="org" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
              <option value="org">Your side</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
            Propose population
          </button>
        </form>
        <p className="mt-2 text-[11px] text-neutral-400">
          Members + fields (territory, vertical, segment, owner, contacts) come from a CSV ingest — the attributes model
          is ready; the ingest wiring is the next step. Proposed lists start pending until approved.
        </p>
      </Card>
    );
  } finally {
    db.release();
  }
}
