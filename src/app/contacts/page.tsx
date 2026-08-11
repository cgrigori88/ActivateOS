import Link from "next/link";
import { getPool } from "@/db/client";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Contacts (Phase 9A): the buying committee per account. Two sources merge —
 * people discovered by the PDL people provider (senior technical committee)
 * and reachable contacts we hold an address for, annotated with engagement.
 * This is the map of the real decision unit a campaign has to move.
 */

interface Person {
  name: string;
  title: string | null;
  level: string;
  email: string | null;
  engagementStatus: string | null;
  engagementScore: number | null;
}
interface AccountCommittee {
  companyId: string;
  legalName: string;
  domain: string | null;
  people: Person[];
  reachable: number;
  engaged: number;
}

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
const LEVEL_TONE: Record<string, string> = {
  cxo: "bg-violet-50 text-violet-800 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  vp: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  director: "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
  manager: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  other: "bg-neutral-100 text-neutral-500 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
};
const ENGAGEMENT_TONE: Record<string, string> = {
  engaged: "text-green-700 dark:text-green-400",
  opted_out: "text-neutral-400 line-through",
  bounced: "text-red-600 dark:text-red-400",
  do_not_contact: "text-neutral-400 line-through",
  unknown: "text-neutral-500",
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

export default async function ContactsPage() {
  const pool = getPool();

  // Discovered committee — latest PDL people observation per company.
  const { rows: discovered } = await pool.query<{
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

  // Reachable contacts with engagement.
  const { rows: reachable } = await pool.query<{
    company_id: string;
    legal_name: string;
    primary_domain: string | null;
    email: string;
    name: string | null;
    title: string | null;
    engagement_status: string;
    engagement_score: string | null;
  }>(
    `select co.id as company_id, co.legal_name, co.primary_domain,
            c.email, c.name, c.title, c.engagement_status,
            (select es.engagement_score from engagement_scores es
              where es.contact_id = c.id order by es.computed_at desc limit 1) as engagement_score
     from contacts c
     join companies co on co.id = c.company_id`,
  );

  // Merge into per-account committees.
  const byCompany = new Map<string, AccountCommittee>();
  const ensure = (id: string, name: string, domain: string | null): AccountCommittee => {
    let a = byCompany.get(id);
    if (!a) {
      a = { companyId: id, legalName: name, domain, people: [], reachable: 0, engaged: 0 };
      byCompany.set(id, a);
    }
    return a;
  };

  for (const d of discovered) {
    if (!d.full_name) continue;
    const a = ensure(d.company_id, d.legal_name, d.primary_domain);
    a.people.push({
      name: d.full_name,
      title: d.job_title,
      level: levelOf(d.job_title),
      email: null,
      engagementStatus: null,
      engagementScore: null,
    });
  }
  for (const r of reachable) {
    const a = ensure(r.company_id, r.legal_name, r.primary_domain);
    const rn = r.name ? norm(r.name) : null;
    const match = rn ? a.people.find((p) => norm(p.name) === rn) : undefined;
    if (match) {
      match.email = r.email;
      match.engagementStatus = r.engagement_status;
      match.engagementScore = r.engagement_score == null ? null : Number(r.engagement_score);
    } else {
      a.people.push({
        name: r.name ?? r.email,
        title: r.title,
        level: levelOf(r.title),
        email: r.email,
        engagementStatus: r.engagement_status,
        engagementScore: r.engagement_score == null ? null : Number(r.engagement_score),
      });
    }
  }

  const accounts = [...byCompany.values()];
  for (const a of accounts) {
    a.people.sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || x.name.localeCompare(y.name));
    a.reachable = a.people.filter((p) => p.email).length;
    a.engaged = a.people.filter((p) => p.engagementStatus === "engaged").length;
  }
  accounts.sort((a, b) => b.people.length - a.people.length || a.legalName.localeCompare(b.legalName));

  const totalPeople = accounts.reduce((n, a) => n + a.people.length, 0);
  const totalReachable = accounts.reduce((n, a) => n + a.reachable, 0);

  return (
    <main>
      <PageHeader
        title="Contacts"
        subtitle="The buying committee per account — discovered by intelligence, made reachable by outreach, annotated with engagement."
      />

      <div className="mb-6 flex flex-wrap gap-6 text-sm text-neutral-500">
        <span><span className="tnum text-lg font-semibold text-neutral-800 dark:text-neutral-200">{accounts.length}</span> accounts</span>
        <span><span className="tnum text-lg font-semibold text-neutral-800 dark:text-neutral-200">{totalPeople}</span> people mapped</span>
        <span><span className="tnum text-lg font-semibold text-neutral-800 dark:text-neutral-200">{totalReachable}</span> reachable</span>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            No committee data yet. The buying committee is discovered when an account crosses the research gate
            (PDL people provider) — escalate accounts on the{" "}
            <Link href="/accounts" className="text-blue-700 hover:underline dark:text-blue-400">Accounts</Link> page.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.companyId}>
              <div className="mb-3 flex items-center gap-2">
                <Link href={`/accounts/${a.companyId}`} className="font-semibold hover:underline">{a.legalName}</Link>
                {a.domain && <span className="text-[11px] text-neutral-400">{a.domain}</span>}
                <span className="ml-auto text-xs text-neutral-400">{a.reachable}/{a.people.length} reachable</span>
              </div>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {a.people.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 py-1.5">
                    <span className={`inline-flex w-16 shrink-0 justify-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${LEVEL_TONE[p.level]}`}>
                      {LEVELS.find((l) => l.key === p.level)?.label ?? "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      {p.title && <div className="truncate text-[11px] text-neutral-500">{p.title}</div>}
                    </div>
                    {p.email ? (
                      <span className={`text-[11px] ${ENGAGEMENT_TONE[p.engagementStatus ?? "unknown"]}`} title={p.email}>
                        {p.engagementScore != null && p.engagementScore > 0 ? `${p.engagementScore.toFixed(0)} · ` : ""}
                        {p.engagementStatus ?? "reachable"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-neutral-300 dark:text-neutral-600">no address</span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
