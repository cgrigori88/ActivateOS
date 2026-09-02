import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import { Bento, Card, PageHeader, Disclosure } from "@/components/ui";
import { EvidenceModel } from "@/components/evidence-model";
import { QuerySelect } from "@/components/query-select";
import { captureContactsFromPopulations } from "@/lib/contacts/capture";

export const dynamic = "force-dynamic";

/**
 * Contacts (#52) — one taxonomy for the whole co-sell committee. It merges three
 * sources into typed, filterable people:
 *   • end users we can reach (contacts table, engagement-annotated)
 *   • end users discovered by intelligence (PDL people committee, no address yet)
 *   • partner reps who own each mapped account (captured from the account lists —
 *     reseller / distributor / MSP owners, with territory & vertical)
 * Deep filters (type · partner · seniority · engagement · search) and a group-by
 * lens (company / partner / type) keep it usable at scale, and it doubles as the
 * cleanest training signal we hold: who the real decision + selling unit is.
 *
 * WAVE 5 §8. The room knew all of this and showed almost none of it. Each person
 * was a twelve-column row — Contact, Company, Type, Email, Phone, Partner, Brand,
 * Territory, Vertical, Segment, Location, Engagement — in which nine cells were
 * an em-dash for a typical end user, because territory, vertical and segment are
 * attributes only a captured partner rep carries. A grid that is mostly dashes
 * teaches the reader to stop reading it.
 *
 * The row is now the six things a seller actually decides on:
 *
 *   Person · Role · Company · Relationship · Reach · Pursuits
 *
 * Nothing was dropped. Coverage attributes move to a quiet line under the person
 * and appear only where the person has them; the rest is one click away on the
 * contact's own page, which is new in this wave and is where the full record,
 * every buying-role assertion and the interaction history now live.
 *
 * One honesty constraint shapes the linking: people discovered by intelligence
 * have no contact row, so they get no detail link. A page for a person the
 * system cannot act on would be a fiction, and a dead link is worse than none.
 */

const TYPE_LABELS: Record<string, string> = {
  end_user: "End user",
  reseller: "Reseller",
  distributor: "Distributor",
  msp: "MSP",
  solution_provider: "Solution provider",
  agent: "Agent",
  alliance: "Alliance",
  vendor: "Vendor",
  other: "Other",
};
const TYPE_TONE: Record<string, string> = {
  end_user: "bg-blue-50 text-accent ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300",
  reseller: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
  distributor: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  msp: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  solution_provider: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950 dark:text-teal-300",
  agent: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  alliance: "bg-pink-50 text-pink-700 ring-pink-600/20 dark:bg-pink-950 dark:text-pink-300",
  vendor: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950 dark:text-orange-300",
  other: "bg-neutral-100 text-neutral-500 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
};

const LEVELS: { key: string; label: string; test: RegExp }[] = [
  { key: "cxo", label: "C-suite", test: /\b(chief|cxo|ceo|cto|cio|ciso|cfo|coo|president|founder)\b/i },
  { key: "vp", label: "VP", test: /\b(vp|vice president|svp|evp)\b/i },
  { key: "director", label: "Director", test: /\bdirector\b/i },
  { key: "manager", label: "Manager", test: /\b(manager|head|lead)\b/i },
];
function levelOf(title: string | null): string {
  if (!title) return "other";
  for (const l of LEVELS) if (l.test.test(title)) return l.key;
  return "other";
}
const LEVEL_RANK: Record<string, number> = { cxo: 0, vp: 1, director: 2, manager: 3, other: 4 };
const LEVEL_LABEL: Record<string, string> = { cxo: "C-suite", vp: "VP", director: "Director", manager: "Manager", other: "—" };

const ENGAGEMENT_TONE: Record<string, string> = {
  engaged: "text-positive dark:text-green-400",
  opted_out: "text-neutral-400 line-through",
  bounced: "text-red-600 dark:text-red-400",
  do_not_contact: "text-neutral-400 line-through",
  unknown: "text-neutral-500",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

interface Row {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  contactType: string;
  level: string;
  companyId: string | null;
  legalName: string;
  domain: string | null;
  partnerName: string | null;
  brand: string | null;
  territory: string | null;
  vertical: string | null;
  segment: string | null;
  location: string | null;
  engagementStatus: string | null;
  engagementScore: number | null;
  /** P1C §14: lightweight link to the canonical assertion — role · state · pursuit. */
  stakeholder: { role: string; state: string; pursuitId: string | null } | null;
  /** True only for rows backed by a contacts record — the ones with a detail page. */
  linkable: boolean;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; partner?: string; level?: string; eng?: string; group?: string; q?: string }>;
}) {
  const sp = await searchParams;

  const { typed, metaRows, discovered } = await withTenant(async (db, orgId) => {
    // Keep the partner-rep side of the taxonomy in sync with current mappings.
    try {
      await captureContactsFromPopulations(db, orgId);
    } catch {
      /* non-fatal: taxonomy still renders from whatever is stored */
    }

    // Typed contacts (reachable end users + captured partner reps).
    const { rows: typed } = await db.query<{
      id: string;
      name: string | null;
      title: string | null;
      email: string | null;
      phone: string | null;
      contact_type: string;
      company_id: string | null;
      legal_name: string | null;
      primary_domain: string | null;
      partner_name: string | null;
      location: string | null;
      attributes: Record<string, unknown> | null;
      engagement_status: string;
      engagement_score: string | null;
      sh_role: string | null;
      sh_state: string | null;
      sh_pursuit: string | null;
    }>(
      `select c.id, c.name, c.title, c.email, c.phone, c.contact_type,
              c.company_id, co.legal_name, co.primary_domain,
              p.name as partner_name, c.location, c.attributes, c.engagement_status,
              (select es.engagement_score from engagement_scores es
                where es.contact_id = c.id order by es.computed_at desc limit 1) as engagement_score,
              sh.role sh_role, sh.assertion_state sh_state, sh.pursuit_id sh_pursuit
       from contacts c
       left join companies co on co.id = c.company_id
       left join partners p on p.id = c.partner_id
       /* pu.id, not s.pursuit_id. A stakeholder row survives a pursuit its reader
          cannot see — RLS is right to hide it, and stakeholders carries no org_id
          of its own. Taking the id from the joined row means a link is offered
          only where the destination is actually readable by this tenant. */
       left join lateral (
         select s.role, s.assertion_state, pu.id as pursuit_id from stakeholders s
          left join pursuits pu on pu.id = s.pursuit_id
          where s.contact_id = c.id
          order by case s.assertion_state when 'verified' then 3 when 'inferred' then 2 else 1 end desc,
                   s.asserted_at desc nulls last limit 1) sh on true`,
    );

    // Per-account context: HQ location (for end users) + the brand/solution in
    // play at the account (its top-fit product line). Keyed by company.
    const { rows: metaRows } = await db.query<{ company_id: string; location: string | null; brand: string | null }>(
      `select c.id as company_id,
              nullif(concat_ws(', ', c.state, c.country), '') as location,
              (select n.name from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
                where p.company_id = c.id order by p.score desc nulls last, p.computed_at desc limit 1) as brand
       from companies c`,
    );

    // Discovered committee — latest PDL people observation per company (end users).
    const { rows: discovered } = await db.query<{
      company_id: string;
      legal_name: string;
      primary_domain: string | null;
      full_name: string | null;
      job_title: string | null;
    }>(
      `with latest as (
         select distinct on (company_id) company_id, raw_payload
         from raw_observations
         where provider_id = 'pdl_people' and raw_payload ? 'people'
         order by company_id, observed_at desc
       )
       select c.id as company_id, c.legal_name, c.primary_domain,
              p->>'fullName' as full_name, p->>'jobTitle' as job_title
       from latest l
       join companies c on c.id = l.company_id
       cross join lateral jsonb_array_elements(l.raw_payload->'people') as p`,
    );

    return { typed, metaRows, discovered };
  });
  const companyMeta = new Map(metaRows.map((r) => [r.company_id, { location: r.location, brand: r.brand }]));

  const rows: Row[] = [];
  // typed
  for (const t of typed) {
    const attrs = t.attributes ?? {};
    const meta = t.company_id ? companyMeta.get(t.company_id) : undefined;
    const territory = (attrs.territory as string | undefined) ?? t.location ?? null;
    rows.push({
      id: t.id,
      name: t.name ?? t.email ?? "—",
      title: t.title,
      email: t.email,
      phone: t.phone,
      contactType: t.contact_type,
      level: t.contact_type === "end_user" ? levelOf(t.title) : "other",
      companyId: t.company_id,
      legalName: t.legal_name ?? "Unattributed",
      domain: t.primary_domain,
      partnerName: t.partner_name,
      brand: meta?.brand ?? null,
      territory,
      vertical: (attrs.vertical as string | undefined) ?? null,
      segment: (attrs.segment as string | undefined) ?? null,
      // Reps carry their coverage territory; end users show their account HQ.
      location: t.contact_type === "end_user" ? meta?.location ?? null : t.location ?? territory,
      engagementStatus: t.contact_type === "end_user" ? t.engagement_status : null,
      engagementScore: t.engagement_score == null ? null : Number(t.engagement_score),
      stakeholder: t.sh_role ? { role: t.sh_role, state: t.sh_state ?? "unverified", pursuitId: t.sh_pursuit } : null,
      linkable: true,
    });
  }
  // discovered — only if not already an end-user contact of the same name at the company.
  const seen = new Set(rows.filter((r) => r.contactType === "end_user" && r.companyId).map((r) => `${r.companyId}:${norm(r.name)}`));
  for (const d of discovered) {
    if (!d.full_name) continue;
    const key = `${d.company_id}:${norm(d.full_name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: `pdl:${d.company_id}:${norm(d.full_name)}`,
      name: d.full_name,
      title: d.job_title,
      email: null,
      phone: null,
      contactType: "end_user",
      level: levelOf(d.job_title),
      companyId: d.company_id,
      legalName: d.legal_name,
      domain: d.primary_domain,
      partnerName: null,
      brand: companyMeta.get(d.company_id)?.brand ?? null,
      territory: null,
      vertical: null,
      segment: null,
      location: companyMeta.get(d.company_id)?.location ?? null,
      engagementStatus: null,
      engagementScore: null,
      stakeholder: null,
      linkable: false,
    });
  }

  // Filter option universes (from the full set).
  const typeOptions = [...new Set(rows.map((r) => r.contactType))].sort((a, b) => (a === "end_user" ? -1 : b === "end_user" ? 1 : a.localeCompare(b)));
  const partnerOptions = [...new Set(rows.map((r) => r.partnerName).filter(Boolean) as string[])].sort();

  // Apply filters.
  const q = (sp.q ?? "").trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (sp.type && sp.type !== "all" && r.contactType !== sp.type) return false;
    if (sp.partner && sp.partner !== "all") {
      if (sp.partner === "__direct") { if (r.partnerName) return false; }
      else if (r.partnerName !== sp.partner) return false;
    }
    if (sp.level && sp.level !== "all" && r.level !== sp.level) return false;
    if (sp.eng && sp.eng !== "all") {
      if (sp.eng === "reachable" && !r.email) return false;
      if (sp.eng === "engaged" && r.engagementStatus !== "engaged") return false;
      if (sp.eng === "no_address" && r.email) return false;
    }
    if (q) {
      const hay = `${r.name} ${r.title ?? ""} ${r.email ?? ""} ${r.phone ?? ""} ${r.legalName} ${r.partnerName ?? ""} ${r.brand ?? ""} ${r.territory ?? ""} ${r.vertical ?? ""} ${r.segment ?? ""} ${r.location ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Bentos (from the full set).
  const endUsers = rows.filter((r) => r.contactType === "end_user").length;
  const reps = rows.length - endUsers;
  const reachable = rows.filter((r) => r.email).length;
  const companies = new Set(rows.map((r) => r.companyId ?? "—")).size;

  // Group.
  const groupKey = ["company", "partner", "type"].includes(sp.group ?? "") ? sp.group! : "company";
  const groups = new Map<string, { name: string; companyId: string | null; sub?: string; items: Row[] }>();
  for (const r of filtered) {
    let key: string, name: string, companyId: string | null = null, sub: string | undefined;
    if (groupKey === "partner") {
      key = r.partnerName ? `p:${r.partnerName}` : "_direct";
      name = r.partnerName ?? "Direct (end users)";
    } else if (groupKey === "type") {
      key = `t:${r.contactType}`;
      name = TYPE_LABELS[r.contactType] ?? r.contactType;
    } else {
      key = r.companyId ?? "_none";
      name = r.legalName;
      companyId = r.companyId;
      sub = r.domain ?? undefined;
    }
    const g = groups.get(key) ?? { name, companyId, sub, items: [] };
    g.items.push(r);
    groups.set(key, g);
  }
  const grouped = [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  for (const g of grouped) {
    g.items.sort(
      (x, y) =>
        (x.contactType === "end_user" ? 0 : 1) - (y.contactType === "end_user" ? 0 : 1) ||
        LEVEL_RANK[x.level] - LEVEL_RANK[y.level] ||
        x.name.localeCompare(y.name),
    );
  }

  // Preserve current filters when the search form navigates.
  const hidden: Record<string, string | undefined> = { type: sp.type, partner: sp.partner, level: sp.level, eng: sp.eng, group: sp.group };

  return (
    <main>
      <PageHeader
        title="Contacts"
        subtitle="The full co-sell committee — end users and the partner reps who own each account."
      />
      <EvidenceModel
        current="contacts"
        steps={{ contacts: { detail: `${reachable} of ${rows.length} reachable` } }}
      />

      {/* What the room's counts actually mean before anyone reads a row: a
          contact the system knows about and a contact you can reach are two
          different things, and most of these are the first kind. */}
      <Card className="mb-4">
        <p className="text-title font-semibold ink">
          {rows.length === 0
            ? "No people known yet."
            : reachable === rows.length
              ? `All ${rows.length} people here can be reached.`
              : `${reachable} of ${rows.length} people here can actually be reached.`}
        </p>
        <p className="mt-1 text-body ink-muted">
          {rows.length === 0
            ? "End users appear once an account crosses the research gate; partner reps are captured from approved account lists."
            : reachable === rows.length
              ? "Everyone listed carries an address. As intelligence finds more of each account's committee, people will appear here who are known but not contactable — this room keeps those two facts apart."
              : "The rest are known — named on a partner's account list or found by intelligence — but carry no address. Knowing who somebody is and being able to contact them are separate facts, and this room keeps them separate."}
        </p>
      </Card>

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Bento label="contacts" value={rows.length} href="/contacts" />
        <Bento label="end users" value={endUsers} href="/contacts?type=end_user" />
        <Bento label="partner reps" value={reps} href="/contacts?group=partner" />
        <Bento label="reachable" value={reachable} subs={[`${Math.round((reachable / Math.max(1, rows.length)) * 100)}% w/ address`]} href="/contacts?eng=reachable" />
        <Bento label="companies" value={companies} href="/contacts?group=company" />
        <Bento label="partners" value={partnerOptions.length} href="/mapping" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="group" value={groupKey} label="Group by" options={[{ value: "company", label: "Company" }, { value: "partner", label: "Partner" }, { value: "type", label: "Type" }]} />
        <QuerySelect param="type" value={sp.type ?? "all"} label="Type" options={[{ value: "all", label: "Any type" }, ...typeOptions.map((t) => ({ value: t, label: TYPE_LABELS[t] ?? t }))]} />
        {partnerOptions.length > 0 && (
          <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "__direct", label: "Direct (no partner)" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        )}
        <QuerySelect param="level" value={sp.level ?? "all"} label="Seniority" options={[{ value: "all", label: "Any level" }, ...LEVELS.map((l) => ({ value: l.key, label: l.label })), { value: "other", label: "Other" }]} />
        <QuerySelect param="eng" value={sp.eng ?? "all"} label="Reach" options={[{ value: "all", label: "Any" }, { value: "reachable", label: "Reachable" }, { value: "engaged", label: "Engaged" }, { value: "no_address", label: "No address" }]} />
        <form className="ml-auto flex items-center gap-2">
          {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search name, title, company…"
            className="w-56 rounded-control border border-neutral-300 bg-white px-2.5 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900"
          />
          {q && <Link href={{ query: { ...hidden } }} className="text-body text-neutral-500 hover:underline">clear</Link>}
        </form>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-copy text-neutral-500">
            {rows.length === 0 ? (
              <>
                No contacts yet. End users are discovered when accounts cross the research gate; partner reps are captured
                from approved account lists in the{" "}
                <Link href="/mapping" className="text-accent hover:underline dark:text-blue-400">Mapping room</Link>.
              </>
            ) : (
              "Nothing matches these filters."
            )}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {grouped.map((g) => {
            // Type breakdown chip set for the collapsed row.
            const byType = new Map<string, number>();
            for (const r of g.items) byType.set(r.contactType, (byType.get(r.contactType) ?? 0) + 1);
            const reachableN = g.items.filter((r) => r.email).length;
            const showCompanyCol = groupKey !== "company";
            /* Grouping by type already states the role in the group header —
               repeating it in every row is a column of the same word. */
            const showRoleCol = groupKey !== "type";
            return (
              <Card key={g.companyId ?? g.name} className="p-0">
                <details open={grouped.length === 1} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                    <span className="text-neutral-400 transition-transform group-open:rotate-90" aria-hidden>▸</span>
                    {groupKey !== "company" && (
                      <span className="rounded-inner bg-neutral-100 px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">{groupKey}</span>
                    )}
                    <span className="font-semibold">{g.name}</span>
                    {g.sub && <span className="text-label text-neutral-400">{g.sub}</span>}
                    {groupKey === "company" && g.companyId && (
                      <Link href={`/accounts/${g.companyId}`} className="text-body text-accent hover:underline dark:text-blue-400">account →</Link>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {[...byType.entries()].map(([t, n]) => (
                        <span key={t} className={`rounded-inner px-1.5 py-0.5 text-micro font-medium ring-1 ring-inset ${TYPE_TONE[t] ?? TYPE_TONE.other}`}>{n} {TYPE_LABELS[t] ?? t}</span>
                      ))}
                      <span className="tnum ml-1 text-body text-neutral-400">{g.items.length} contact{g.items.length === 1 ? "" : "s"} · {reachableN} reachable</span>
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t border-neutral-100 scroll-thin dark:border-neutral-800">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Person</th>
                          {showRoleCol && <th>Role</th>}
                          {showCompanyCol && <th>Company</th>}
                          <th>Relationship</th>
                          <th>Reach</th>
                          <th>Pursuits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((r) => {
                          /* Coverage attributes only a captured rep carries. Rendered
                             where they exist, absent where they do not — never as a
                             column of dashes. */
                          const coverage = [r.brand, r.territory, r.vertical, r.segment, r.location].filter(Boolean);
                          return (
                          <tr key={r.id}>
                            <td>
                              <div className="font-medium">
                                {r.linkable ? (
                                  <Link href={`/contacts/${r.id}`} className="text-accent hover:underline dark:text-blue-400">{r.name}</Link>
                                ) : (
                                  r.name
                                )}
                              </div>
                              <div className="text-label text-neutral-400">
                                {r.title ?? "role not recorded"}
                                {r.contactType === "end_user" && r.level !== "other" && <span className="ml-1 text-neutral-500">· {LEVEL_LABEL[r.level]}</span>}
                              </div>
                              {coverage.length > 0 && (
                                <div className="text-label text-neutral-400">{coverage.join(" · ")}</div>
                              )}
                            </td>
                            {showRoleCol && (
                              <td>
                                <span className={`rounded-inner px-1.5 py-0.5 text-micro font-medium ring-1 ring-inset ${TYPE_TONE[r.contactType] ?? TYPE_TONE.other}`}>{TYPE_LABELS[r.contactType] ?? r.contactType}</span>
                              </td>
                            )}
                            {showCompanyCol && (
                              <td className="text-body">
                                {r.companyId ? <Link href={`/accounts/${r.companyId}`} className="text-accent hover:underline dark:text-blue-400">{r.legalName}</Link> : r.legalName}
                              </td>
                            )}
                            <td className="text-body">
                              {r.partnerName ? (
                                <span className="text-neutral-600 dark:text-neutral-300">via {r.partnerName}</span>
                              ) : (
                                <span className="text-neutral-500">Direct</span>
                              )}
                            </td>
                            {/* Reach is one answer, not three columns: can we contact
                                them, by what, and did it work. */}
                            <td className="text-body">
                              {r.email ? (
                                <>
                                  <a href={`mailto:${r.email}`} className="text-accent hover:underline dark:text-blue-400">{r.email}</a>
                                  {/* §10: "unknown" is the stored value, not the fact.
                                      The fact is that nothing has come back. */}
                                  <div className={`text-label ${ENGAGEMENT_TONE[r.engagementStatus ?? "unknown"]}`}>
                                    {r.engagementScore != null && r.engagementScore > 0 ? `${r.engagementScore.toFixed(0)} · ` : ""}
                                    {r.engagementStatus == null || r.engagementStatus === "unknown"
                                      ? "no reply yet"
                                      : r.engagementStatus.replace(/_/g, " ")}
                                    {r.phone && <span className="text-neutral-400"> · {r.phone}</span>}
                                  </div>
                                </>
                              ) : r.phone ? (
                                <span className="text-neutral-600 dark:text-neutral-300">{r.phone}</span>
                              ) : (
                                <span className="text-neutral-400">no address</span>
                              )}
                            </td>
                            {/* P1C §14: light indicator only — the interpretation lives on the Pursuit. */}
                            <td className="text-body">
                              {r.stakeholder ? (
                                <Link href={r.stakeholder.pursuitId ? `/pursuits/${r.stakeholder.pursuitId}#stakeholders` : "/pipeline"}
                                  className={`rounded-full px-1.5 py-px text-micro font-semibold hover:underline ${r.stakeholder.state === "verified" ? "bg-emerald/12 text-emerald-700 dark:text-emerald-300" : r.stakeholder.state === "inferred" ? "bg-violet/12 text-violet-700 dark:text-violet-300" : "bg-neutral-500/10 text-neutral-500"}`}
                                  title={`Buying-role assertion on the linked pursuit — ${r.stakeholder.state}`}>
                                  {r.stakeholder.role.replace(/_/g, " ")} · {r.stakeholder.state}
                                </Link>
                              ) : (
                                <span className="text-neutral-400">none asserted</span>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Card>
            );
          })}
          <Disclosure summary="Why some names are links and others are not" className="px-1 pt-1">
            A name is a link when the person has a contact record — that is what a detail page reads
            from. People found by intelligence on an account&rsquo;s public committee are listed
            because knowing they exist is useful, but nothing is stored about them beyond a name and
            a title, so there is no page to open and no action to take.
          </Disclosure>
        </div>
      )}
    </main>
  );
}
