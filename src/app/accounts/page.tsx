import Link from "next/link";
import { getPool } from "@/db/client";
import {
  BAND_LABELS,
  BandBadge,
  CountChip,
  DimensionBars,
  FilterPill,
  PageHeader,
  SearchBox,
  SortHeader,
  Toolbar,
} from "@/components/ui";
import { QuerySelect } from "@/components/query-select";

export const dynamic = "force-dynamic";

const BANDS = ["very_high", "high", "medium", "low"] as const;
const BAND_TONES: Record<string, "green" | "sky" | "amber" | "neutral"> = {
  very_high: "green",
  high: "sky",
  medium: "amber",
  low: "neutral",
};
const DIM_ORDER = [
  "purchase_need",
  "purchase_propensity",
  "timing",
  "solution_fit",
  "evidence_confidence",
  "corroboration",
  "convergence",
];

interface Params {
  band?: string;
  q?: string;
  sort?: string;
  industry?: string;
  routed?: string;
}

function buildQS(params: Params, overrides: Partial<Params>): string {
  const merged = { ...params, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const { band, q, industry, routed } = params;
  const sort = params.sort ?? "-score";
  const pool = getPool();

  const { rows: all } = await pool.query(
    `select latest.*, pt.partner_name, pt.team_status,
            c.refresh_tier, c.next_refresh_at, c.country,
            (select count(*) from evidence e
              where e.company_id = latest.company_id and e.status = 'verified') as evidence_count
     from (
       select distinct on (p.company_id)
         p.id as score_id, p.company_id, p.score, p.band, p.changes,
         c2.legal_name, c2.industry, n.slug
       from propensity_scores p
       join companies c2 on c2.id = p.company_id
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
       order by p.company_id, p.computed_at desc
     ) latest
     join companies c on c.id = latest.company_id
     left join lateral (
       select pa.name as partner_name, t.status as team_status
       from pursuit_teams t join partners pa on pa.id = t.partner_id
       where t.company_id = latest.company_id and t.status in ('recommended','accepted')
       order by t.created_at desc limit 1) pt on true`,
  );

  const { rows: dimRows } = await pool.query(
    `select score_id, dimension, value from propensity_dimensions where score_id = any($1)`,
    [all.map((r) => r.score_id)],
  );
  const dimsByScore = new Map<string, Map<string, number>>();
  for (const d of dimRows) {
    const m = dimsByScore.get(d.score_id) ?? new Map();
    m.set(d.dimension, Number(d.value));
    dimsByScore.set(d.score_id, m);
  }

  const counts: Record<string, number> = { all: all.length };
  for (const b of BANDS) counts[b] = all.filter((r) => r.band === b).length;

  const industryOptions = [...new Set(all.map((r) => r.industry).filter(Boolean) as string[])].sort();

  let rows = all;
  if (band) rows = rows.filter((r) => r.band === band);
  if (industry) rows = rows.filter((r) => r.industry === industry);
  if (routed === "routed") rows = rows.filter((r) => r.partner_name);
  if (routed === "unrouted") rows = rows.filter((r) => !r.partner_name);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.legal_name.toLowerCase().includes(needle) ||
        (r.industry ?? "").toLowerCase().includes(needle) ||
        (r.partner_name ?? "").toLowerCase().includes(needle),
    );
  }
  const key = sort.replace(/^-/, "");
  const dir = sort.startsWith("-") ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    const va =
      key === "score" ? Number(a.score)
      : key === "evidence" ? Number(a.evidence_count)
      : key === "refresh" ? (a.next_refresh_at ? new Date(a.next_refresh_at).getTime() : Infinity)
      : String(a.legal_name).toLowerCase();
    const vb =
      key === "score" ? Number(b.score)
      : key === "evidence" ? Number(b.evidence_count)
      : key === "refresh" ? (b.next_refresh_at ? new Date(b.next_refresh_at).getTime() : Infinity)
      : String(b.legal_name).toLowerCase();
    return va < vb ? -dir : va > vb ? dir : 0;
  });

  const makeSortHref = (s: string) => `/accounts${buildQS(params, { sort: s })}`;

  return (
    <main>
      <PageHeader
        title="Accounts"
        subtitle={`${rows.length} of ${all.length} scored accounts — every number filters, every row explains itself.`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <CountChip
          label="Total"
          value={counts.all}
          href={`/accounts${buildQS(params, { band: undefined })}`}
          active={!band}
        />
        {BANDS.map((b) => (
          <CountChip
            key={b}
            label={BAND_LABELS[b]}
            value={counts[b]}
            tone={BAND_TONES[b]}
            href={`/accounts${buildQS(params, { band: band === b ? undefined : b })}`}
            active={band === b}
          />
        ))}
      </div>

      <Toolbar
        actions={
          <a
            href={`/accounts/export${buildQS(params, {})}`}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            ↓ CSV
          </a>
        }
      >
        <SearchBox
          placeholder="Search accounts, industries, partners…"
          defaultValue={q}
          hidden={{ band, sort: params.sort, industry, routed }}
        />
        {industryOptions.length > 0 && (
          <QuerySelect param="industry" value={industry ?? "all"} label="Industry" options={[{ value: "all", label: "Any industry" }, ...industryOptions.map((i) => ({ value: i, label: i }))]} />
        )}
        <QuerySelect param="routed" value={routed ?? "all"} label="Routing" options={[{ value: "all", label: "Any" }, { value: "routed", label: "Routed" }, { value: "unrouted", label: "Unrouted" }]} />
        {(band || q || industry || routed) && (
          <>
            {band && (
              <FilterPill
                label={`Band: ${BAND_LABELS[band] ?? band}`}
                clearHref={`/accounts${buildQS(params, { band: undefined })}`}
              />
            )}
            {q && (
              <FilterPill label={`“${q}”`} clearHref={`/accounts${buildQS(params, { q: undefined })}`} />
            )}
            <Link href="/accounts" className="text-xs text-neutral-500 hover:underline">
              Clear all
            </Link>
          </>
        )}
      </Toolbar>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white scroll-thin dark:border-neutral-800 dark:bg-neutral-900">
        <table className="data-table">
          <thead>
            <tr>
              <th>
                <SortHeader label="Account" sortKey="name" current={sort} makeHref={makeSortHref} />
              </th>
              <th>Industry</th>
              <th>
                <SortHeader label="Score" sortKey="score" current={sort} makeHref={makeSortHref} />
              </th>
              <th>Band</th>
              <th>Dims</th>
              <th>Δ</th>
              <th>Routed partner</th>
              <th>
                <SortHeader label="Evidence" sortKey="evidence" current={sort} makeHref={makeSortHref} />
              </th>
              <th>
                <SortHeader label="Refresh" sortKey="refresh" current={sort} makeHref={makeSortHref} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-neutral-500">
                  No accounts match — clear filters or ingest and score accounts.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const dims = dimsByScore.get(r.score_id);
              const delta = r.changes?.delta;
              const refreshDue =
                r.next_refresh_at && new Date(r.next_refresh_at).getTime() < Date.now();
              return (
                <tr key={r.company_id}>
                  <td>
                    <Link
                      href={`/accounts/${r.company_id}`}
                      className="font-medium text-blue-800 hover:underline dark:text-blue-300"
                    >
                      {r.legal_name}
                    </Link>
                  </td>
                  <td className="text-neutral-500">{r.industry ?? "—"}</td>
                  <td className="tnum text-base font-semibold">{Number(r.score).toFixed(0)}</td>
                  <td>
                    <BandBadge band={r.band} />
                  </td>
                  <td>
                    {dims ? (
                      <DimensionBars values={DIM_ORDER.map((d) => dims.get(d) ?? 0)} />
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td
                    className={`tnum text-xs font-medium ${
                      delta > 0
                        ? "text-green-700 dark:text-green-400"
                        : delta < 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-neutral-400"
                    }`}
                  >
                    {delta == null ? "—" : delta > 0 ? `+${delta}` : `${delta}`}
                  </td>
                  <td className="text-neutral-600 dark:text-neutral-400">
                    {r.partner_name ?? <span className="text-neutral-300 dark:text-neutral-600">unrouted</span>}
                    {r.team_status === "accepted" && (
                      <span className="ml-1 text-[10px] font-semibold uppercase text-green-700 dark:text-green-400">
                        ✓
                      </span>
                    )}
                  </td>
                  <td className="tnum text-neutral-500">{r.evidence_count}</td>
                  <td className={`text-xs ${refreshDue ? "font-semibold text-amber-700 dark:text-amber-400" : "text-neutral-400"}`}>
                    {r.next_refresh_at
                      ? new Date(r.next_refresh_at).toISOString().slice(0, 10)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
