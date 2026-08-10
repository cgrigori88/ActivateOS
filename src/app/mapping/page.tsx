import Link from "next/link";
import { getPool } from "@/db/client";
import { BandBadge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Mapping (Phase 8): where the SAME account shows up across a reseller, a
 * distributor and a vendor — the overlap that founds a co-sell campaign. Three
 * lenses: overlap + motion, coverage/conflict grid, and propensity-ranked
 * shared targets.
 */

type View = "overlap" | "coverage" | "targets";
const VIEWS: { key: View; label: string }[] = [
  { key: "overlap", label: "Overlap + motion" },
  { key: "coverage", label: "Coverage & conflict" },
  { key: "targets", label: "Ranked targets" },
];

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
  searchParams: Promise<{ view?: string; partner?: string }>;
}) {
  const sp = await searchParams;
  const view: View = (["overlap", "coverage", "targets"].includes(sp.view ?? "") ? sp.view : "overlap") as View;
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
