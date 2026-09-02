import Link from "next/link";
import { withTenant } from "@/lib/db/tenant";
import {
  BandBadge,
  Card,
  CompletenessGrid,
  EvidenceLine,
  FEATURE_LABELS,
  PageHeader,
  StatusBadge,
  fieldClass, BlockLabel } from "@/components/ui";
import { loadCompanyIntel } from "@/lib/intel/company-intel";
import { CONFIDENCE_FORMULA, confidenceTone, contextConfidence } from "@/lib/context/confidence";
import { addMeetingNoteAction, setTeamStatusAction } from "./actions";
import { draftAccountMotionAction } from "@/app/motions/actions";
import { dealTimeline, type TimelineEvent } from "@/lib/context/timeline";
import { listMeetingNotes } from "@/lib/context/meetings";
import { buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";
// AI drafting actions invoked from this segment can run tens of seconds —
// raise the serverless limit so generation never dies as a platform timeout.
export const maxDuration = 60;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const data = await withTenant(async (db, orgId) => {
  const { rows: companies } = await db.query(
    `select legal_name, primary_domain, industry, employee_count, country from companies where id = $1`,
    [id],
  );
  if (companies.length === 0) {
    return null;
  }
  const company = companies[0];

  // Latest account digest for this company (Routines, task #73).
  const { rows: digests } = await db.query<{ items: unknown; period_end: Date }>(
    `select d.items, d.period_end from account_digests d
     where d.company_id = $1 and d.org_id = $2
     order by d.created_at desc limit 1`,
    [id, orgId],
  );
  const digest = digests[0] ?? null;

  // Draft-a-motion affordance (task #83): one open motion per account — if
  // one exists the button becomes the road to it instead of a duplicate.
  const { rows: openMotions } = await db.query<{ id: string; status: string }>(
    `select id, status from revenue_motions
     where company_id = $1 and status in ('draft', 'approved', 'active')
     order by created_at desc limit 1`,
    [id],
  );
  const openMotion = openMotions[0] ?? null;

  // The account flight recorder (task #83): every system's events fused into
  // one record, each with provenance; the partner half consent-filtered by
  // construction.
  const timeline: TimelineEvent[] = await dealTimeline(db, orgId, id, 40);
  const meetings = await listMeetingNotes(db, orgId, id);

  const { rows: scores } = await db.query(
    `select p.id, p.score, p.band, n.slug, p.computed_at,
            p.prev_score, p.positive_points, p.negative_points, p.changes
     from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.company_id = $1 order by p.computed_at desc limit 1`,
    [id],
  );

  let dimensions: { dimension: string; value: string }[] = [];
  if (scores.length > 0) {
    const result = await db.query(
      `select dimension, value from propensity_dimensions where score_id = $1
       order by dimension`,
      [scores[0].id],
    );
    dimensions = result.rows;
  }

  let features: { feature: string; contribution: string; evidence_ids: string[] }[] = [];
  let evidence = new Map<string, { claim: string; source_type: string; computed_confidence: string }>();
  if (scores.length > 0) {
    const result = await db.query(
      `select feature, contribution, evidence_ids from score_features
       where score_id = $1 order by contribution desc`,
      [scores[0].id],
    );
    features = result.rows;
    const allIds = [...new Set(features.flatMap((f) => f.evidence_ids))];
    if (allIds.length > 0) {
      const ev = await db.query(
        `select id, claim, source_type, computed_confidence from evidence where id = any($1)`,
        [allIds],
      );
      evidence = new Map(ev.rows.map((e) => [e.id, e]));
    }
  }

  let team: {
    id: string;
    partner_id: string;
    seller: string | null;
    status: string;
    reason: string | null;
  } | null = null;
  {
    const result = await db.query(
      `select t.id, t.partner_id, s.name as seller, t.status, t.reason
       from pursuit_teams t
       left join sellers s on s.id = t.seller_id
       where t.company_id = $1 and t.status in ('recommended','accepted')
       order by t.created_at desc limit 1`,
      [id],
    );
    team = result.rows[0] ?? null;
  }

  let partnerFits: {
    fit_id: string;
    partner_id: string;
    partner: string;
    partner_type: string;
    score: string;
    band: string;
    seller: string | null;
    seller_strength: string | null;
  }[] = [];
  let fitFeatures = new Map<string, { feature: string; contribution: string; detail: string | null }[]>();
  if (scores.length > 0) {
    const result = await db.query(
      `select distinct on (f.partner_id)
              f.id as fit_id, f.partner_id, pa.name as partner, pa.partner_type,
              f.score, f.band, best.name as seller, best.strength as seller_strength
       from partner_fit_scores f
       join partners pa on pa.id = f.partner_id
       left join lateral (
         select s.name, sar.strength
         from seller_account_relationships sar
         join sellers s on s.id = sar.seller_id
         where sar.company_id = f.company_id and s.partner_id = f.partner_id
         order by sar.strength desc limit 1) as best on true
       where f.company_id = $1
       order by f.partner_id, f.computed_at desc`,
      [id],
    );
    partnerFits = result.rows.sort((a, b) => Number(b.score) - Number(a.score));
    if (partnerFits.length > 0) {
      const features = await db.query(
        `select fit_id, feature, contribution, detail from partner_fit_features
         where fit_id = any($1) order by contribution desc`,
        [partnerFits.map((f) => f.fit_id)],
      );
      fitFeatures = features.rows.reduce((m, r) => {
        const list = m.get(r.fit_id) ?? [];
        list.push(r);
        m.set(r.fit_id, list);
        return m;
      }, new Map<string, { feature: string; contribution: string; detail: string | null }[]>());
    }
  }

  const { rows: motions } = await db.query(
    `select m.id, m.status, m.thesis, m.trigger_summary, m.primary_persona, m.secondary_persona,
            m.cta, m.confidence
     from revenue_motions m where m.company_id = $1 order by m.created_at desc limit 1`,
    [id],
  );

  let assets: { asset_type: string; title: string; content: string }[] = [];
  if (motions.length > 0) {
    const result = await db.query(
      `select a.asset_type, a.title, a.content
       from campaign_assets a join campaigns cp on cp.id = a.campaign_id
       where cp.motion_id = $1 order by a.created_at`,
      [motions[0].id],
    );
    assets = result.rows;
  }

  const { rows: events } = await db.query(
    `select event_type, occurred_at from outcome_events where company_id = $1
     order by occurred_at desc limit 10`,
    [id],
  );

  // Intelligence surface (§43): evidence provenance, data completeness, and
  // provider coverage — what we actually know and how well we know it.
  const intel = await loadCompanyIntel(db, id);

  // Context confidence (meets/beats batch): how much of this record is TRUE,
  // current, and broadly sourced — formula shown verbatim in the title.
  const confidence = await contextConfidence(db, orgId, id);

  return {
    company,
    digest,
    openMotion,
    timeline,
    meetings,
    scores,
    dimensions,
    features,
    evidence,
    team,
    partnerFits,
    fitFeatures,
    motions,
    assets,
    events,
    intel,
    confidence,
  };
  });
  if (!data) {
    return <main>Unknown account.</main>;
  }
  const {
    company,
    digest,
    openMotion,
    timeline,
    meetings,
    scores,
    dimensions,
    features,
    evidence,
    team,
    partnerFits,
    fitFeatures,
    motions,
    assets,
    events,
    intel,
    confidence,
  } = data;

  return (
    <main>
      <p className="mb-4 text-copy">
        <Link href="/accounts" className="pos-backlink">
          ← Accounts
        </Link>
      </p>
      <PageHeader
        title={company.legal_name}
        subtitle={[
          company.industry,
          company.primary_domain,
          company.employee_count && `~${company.employee_count} employees`,
          company.country,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {confidence && (
        <div className="-mt-3 mb-4 flex flex-wrap items-center gap-2 text-body" title={CONFIDENCE_FORMULA}>
          <span
            className={`rounded-full px-2.5 py-1 font-bold ${
              confidenceTone(confidence.score) === "emerald"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : confidenceTone(confidence.score) === "amber"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
            }`}
          >
            context confidence {confidence.score}
          </span>
          <span className="text-neutral-500">
            {confidence.verifiedN} verified · {confidence.quarantinedN} in review · {confidence.sourceTypes} source type{confidence.sourceTypes === 1 ? "" : "s"}
            {confidence.freshDays != null && <> · newest {confidence.freshDays === 0 ? "today" : `${confidence.freshDays}d ago`}</>}
            {confidence.contradictions > 0 && <> · <span className="font-semibold text-rose-600 dark:text-rose-400">{confidence.contradictions} open contradiction{confidence.contradictions === 1 ? "" : "s"}</span></>}
          </span>
        </div>
      )}

      {sp.notice && (
        <div className="mb-4 rounded-inner border border-amber-300 bg-amber-50 px-4 py-2.5 text-copy text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {sp.notice}
        </div>
      )}

      {/* Draft a motion from the room (task #83) — same evidence-grounded
          agent as Mapping and the Motions composer. */}
      <div className="-mt-3 mb-6">
        {openMotion ? (
          <Link
            href={`/briefs/${openMotion.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300/80 px-4 py-1.5 text-body font-semibold transition-colors duration-[140ms] hover:bg-neutral-900/[0.04] dark:border-white/15 dark:hover:bg-white/10"
          >
            Open motion ({openMotion.status}) — read the brief <span aria-hidden>→</span>
          </Link>
        ) : (
          <form action={draftAccountMotionAction.bind(null, id)}>
            <button className={buttonClass("primary", "md")}>
              Draft a motion (AI)
            </button>
            <span className="ml-2 text-label text-neutral-400">grounded in this account&apos;s evidence — lands as a draft for your approval</span>
          </form>
        )}
      </div>

      {/* Latest account digest (Routines, task #73) — what changed since the
          last run, written by the weekly digest routine. */}
      {digest && (digest.items as { type: string; text: string; at: string }[]).length > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <BlockLabel>
              What&apos;s new on this account
            </BlockLabel>
            <span className="text-label text-neutral-400">
              digest through {new Date(digest.period_end).toISOString().slice(0, 10)} ·{" "}
              <Link href="/routines" className="text-accent hover:underline dark:text-blue-400">Routines</Link>
            </span>
          </div>
          <ul className="space-y-1.5">
            {(digest.items as { type: string; text: string; at: string }[]).map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-copy">
                <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide ${
                  it.type === "evidence" ? "bg-blue-50 text-accent dark:bg-blue-950/50 dark:text-blue-400"
                  : it.type === "renewal" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                  : it.type === "engagement" || it.type === "meeting" ? "bg-green-50 text-positive dark:bg-green-950/50 dark:text-green-400"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                }`}>{it.type}</span>
                <span className="min-w-0 flex-1">{it.text}</span>
                <span className="shrink-0 text-body text-neutral-400">{it.at}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Deal Timeline — the flight recorder (task #83). Everything fused,
          every event with provenance, the partner half consent-filtered. ── */}
      {timeline.length > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <BlockLabel>Deal timeline</BlockLabel>
            <span className="text-label text-neutral-400">
              every system, one record — each event names its source
            </span>
          </div>
          <ul className="space-y-1.5">
            {timeline.map((ev, i) => (
              <li key={i} className="flex items-start gap-2 text-copy">
                <span className="tnum mt-0.5 w-[76px] shrink-0 font-mono text-label text-neutral-400">
                  {ev.at.slice(0, 10)}
                </span>
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide ${
                    ev.kind === "joint" || ev.kind === "intro" || ev.kind === "shared_evidence"
                      ? "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400"
                      : ev.kind === "renewal"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                        : ev.kind === "reply" || ev.kind === "opportunity" || ev.kind === "meeting"
                          ? "bg-green-50 text-positive dark:bg-green-950/50 dark:text-green-400"
                          : ev.kind === "send" || ev.kind === "motion"
                            ? "bg-blue-50 text-accent dark:bg-blue-950/50 dark:text-blue-400"
                            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                  }`}
                >
                  {ev.kind === "shared_evidence" ? "shared" : ev.kind}
                </span>
                <span className="min-w-0 flex-1">
                  {ev.href ? (
                    <Link href={ev.href} className="hover:underline">{ev.title}</Link>
                  ) : (
                    ev.title
                  )}
                  {ev.detail && <span className="text-neutral-400"> — {ev.detail}</span>}
                </span>
                <span className="shrink-0 font-mono text-micro text-neutral-400" title="provenance">
                  {ev.source}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Meetings (task #86): the engagement signal email can't see ── */}
      <Card className="mb-6">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <BlockLabel>Meetings</BlockLabel>
          <span className="text-label text-neutral-400">
            each note lands as first-party evidence and counts as engagement
          </span>
        </div>
        {meetings.length === 0 ? (
          <p className="mb-3 text-copy text-neutral-500">
            No meetings recorded yet. Paste the recap your meeting tool emails you (Teams and Meet both send one) —
            it grounds the AI, feeds this account&apos;s digest, and keeps the engagement triggers honest.
          </p>
        ) : (
          <ul className="mb-3 space-y-2">
            {meetings.map((m) => (
              <li key={m.id} className="rounded-inner border border-neutral-200 p-3 text-copy dark:border-neutral-800">
                <p className="mb-1 text-label text-neutral-400">
                  <span className="font-semibold text-neutral-600 dark:text-neutral-300">{m.metAt}</span>
                  {m.title && <> · {m.title}</>}
                  {m.attendees && <> · with {m.attendees}</>}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{m.body.length > 400 ? `${m.body.slice(0, 400)}…` : m.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form action={addMeetingNoteAction.bind(null, id)} className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">Meeting date</span>
              <input type="date" name="metAt" required className={fieldClass("md")} />
            </label>
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">Title (optional)</span>
              <input name="title" maxLength={200} placeholder="Technical deep-dive" className={fieldClass("md")} />
            </label>
            <label className="text-copy">
              <span className="mb-1 block text-body text-neutral-500">Attendees (optional)</span>
              <input name="attendees" maxLength={500} placeholder="J. Smith (CTO), our SE" className={`${fieldClass("md")} w-64`} />
            </label>
          </div>
          <label className="block text-copy">
            <span className="mb-1 block text-body text-neutral-500">What happened — notes or a pasted recap</span>
            <textarea name="body" rows={3} required maxLength={8000} placeholder="Decisions, next steps, objections, who said what…" className={`${fieldClass("md", { multiline: true })} w-full`} />
          </label>
          <button className={buttonClass("primary", "md")}>
            Record meeting
          </button>
        </form>
      </Card>

      {scores.length > 0 && (
        <Card className="mb-6">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="tnum text-hero font-semibold">{Number(scores[0].score).toFixed(0)}</span>
            <BandBadge band={scores[0].band} />
            <span className="text-copy text-neutral-500">{scores[0].slug}</span>
            {scores[0].positive_points != null && (
              <span className="ml-auto text-copy text-neutral-500">
                <span className="text-positive dark:text-green-400">
                  +{Number(scores[0].positive_points).toFixed(0)}
                </span>{" "}
                /{" "}
                <span className="text-red-700 dark:text-red-400">
                  {Number(scores[0].negative_points).toFixed(0)}
                </span>{" "}
                net evidence
              </span>
            )}
          </div>

          {dimensions.length > 0 && (
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
              {dimensions.map((d) => (
                <div
                  key={d.dimension}
                  className="rounded-inner bg-neutral-50 px-2 py-1.5 text-center dark:bg-neutral-950"
                >
                  <div className="tnum text-title font-semibold">{Number(d.value).toFixed(0)}</div>
                  <div className="text-micro leading-tight text-neutral-500">
                    {d.dimension.replace(/_/g, " ")}
                  </div>
                </div>
              ))}
            </div>
          )}

          {scores[0].changes?.delta != null && (
            <p className="mb-3 rounded-inner bg-sky-50 px-3 py-2 text-copy text-sky-900 dark:bg-sky-950 dark:text-sky-200">
              <strong>What changed:</strong>{" "}
              {Number(scores[0].changes.delta) >= 0 ? "+" : ""}
              {scores[0].changes.delta} since prior evaluation
              {scores[0].changes.new_evidence_ids?.length > 0 &&
                ` · ${scores[0].changes.new_evidence_ids.length} new evidence item(s)`}
            </p>
          )}

          <BlockLabel>
            Why now
          </BlockLabel>
          {features.map((f) => (
            <div key={f.feature} className="mb-3 last:mb-0">
              <p className="text-copy font-medium">
                <span
                  className={
                    Number(f.contribution) >= 0
                      ? "text-positive dark:text-green-400"
                      : "text-red-700 dark:text-red-400"
                  }
                >
                  {Number(f.contribution) >= 0 ? "+" : ""}
                  {Number(f.contribution).toFixed(1)}
                </span>{" "}
                {FEATURE_LABELS[f.feature] ?? f.feature}
              </p>
              <ul className="ml-4 mt-1 list-disc space-y-0.5">
                {f.evidence_ids.map((eid) => {
                  const e = evidence.get(eid);
                  return e ? (
                    <EvidenceLine
                      key={eid}
                      claim={e.claim}
                      meta={`${e.source_type}, conf ${Number(e.computed_confidence).toFixed(2)}`}
                    />
                  ) : null;
                })}
              </ul>
            </div>
          ))}
        </Card>
      )}

      <Card className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <BlockLabel>
            Data completeness
          </BlockLabel>
          <span className="text-body text-neutral-400">how thoroughly researched — not propensity</span>
        </div>
        <CompletenessGrid byCategory={intel.completeness.byCategory} overall={intel.completeness.overall} />
        {intel.completeness.gaps.length > 0 && (
          <p className="mt-3 text-body text-neutral-500">
            Research gaps: {intel.completeness.gaps.join(", ")}. A gap is missing data, not low intent.
          </p>
        )}
        {intel.coverage.length > 0 && (
          <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <h3 className="mb-2 text-body font-semibold uppercase tracking-wide text-neutral-500">
              Provider coverage
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {intel.coverage.map((c) => (
                <span
                  key={c.providerId}
                  className="inline-flex items-center gap-1.5 rounded-control border border-neutral-200 px-2 py-1 text-body dark:border-neutral-800"
                  title={`${c.runs} run(s), ${c.succeeded} succeeded, ${c.evidence} evidence${
                    c.lastRunAt ? ` · last ${new Date(c.lastRunAt).toISOString().slice(0, 10)}` : ""
                  }`}
                >
                  <StatusBadge status={c.status} />
                  <span className="font-medium">{c.providerId}</span>
                  {c.evidence > 0 && <span className="tnum text-neutral-400">{c.evidence}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {intel.evidence.length > 0 && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <BlockLabel>
              Evidence
            </BlockLabel>
            <span className="text-body text-neutral-400">
              {intel.counts.verified} verified · {intel.counts.quarantined} quarantined ·{" "}
              {intel.counts.rejected} rejected
            </span>
          </div>
          <div className="max-h-96 space-y-1.5 overflow-y-auto scroll-thin pr-1">
            {intel.evidence.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-copy">
                <StatusBadge status={e.status} />
                <span className="flex-1 leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {e.stance === "refutes" && (
                    <span className="mr-1 rounded-inner bg-red-50 px-1 text-micro font-semibold uppercase text-red-700 dark:bg-red-950 dark:text-red-300">
                      refutes
                    </span>
                  )}
                  {e.claim}
                  <span className="ml-1 text-body text-neutral-400">
                    ({e.providerId ?? e.sourceType ?? "n/a"}
                    {e.confidence != null && `, conf ${e.confidence.toFixed(2)}`}
                    {e.firstParty ? ", first-party" : ""})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {partnerFits.length > 0 && (
        <Card className="mb-6">
          <BlockLabel>
            Pursuit team
          </BlockLabel>
          <div className="space-y-3">
            {partnerFits.map((f) => {
              const isRouted = team?.partner_id === f.partner_id;
              return (
                <div
                  key={f.partner_id}
                  className={
                    isRouted
                      ? "rounded-inner border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-950"
                      : "px-3"
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="tnum text-section font-semibold">{Number(f.score).toFixed(0)}</span>
                    <BandBadge band={f.band} />
                    <span className="font-medium">{f.partner}</span>
                    <span className="text-body uppercase tracking-wide text-neutral-400">
                      {f.partner_type?.replace(/_/g, " ")}
                    </span>
                    {isRouted && (
                      <span className="ml-auto text-body font-semibold uppercase text-positive dark:text-green-400">
                        {team?.status === "accepted" ? "Accepted" : "Routed"}
                      </span>
                    )}
                  </div>
                  {f.seller && (
                    <p className="mt-1 text-copy text-neutral-600 dark:text-neutral-400">
                      Seller: <span className="font-medium">{f.seller}</span> (relationship{" "}
                      {Number(f.seller_strength).toFixed(0)}/100)
                    </p>
                  )}
                  <p className="mt-1 text-body text-neutral-500">
                    {(fitFeatures.get(f.fit_id) ?? [])
                      .map((ff) => ff.detail)
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {isRouted && team?.reason && (
                    <p className="mt-1 text-body text-neutral-500">
                      <span className="font-medium">Routing:</span> {team.reason}
                    </p>
                  )}
                  {isRouted && team?.status === "recommended" && (
                    <div className="mt-2 flex gap-2">
                      <form action={setTeamStatusAction.bind(null, team.id, "accepted")}>
                        <button
                          type="submit"
                          className={buttonClass("primary", "sm")}
                        >
                          Accept routing
                        </button>
                      </form>
                      <form action={setTeamStatusAction.bind(null, team.id, "declined")}>
                        <button
                          type="submit"
                          className={buttonClass("primary", "sm")}
                        >
                          Decline
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {motions.length > 0 && (
        <Card className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <BlockLabel>
              Revenue motion
            </BlockLabel>
            <StatusBadge status={motions[0].status} />
            <span className="text-body text-neutral-400">confidence: {motions[0].confidence}</span>
          </div>
          <p className="mb-3 leading-relaxed">{motions[0].thesis}</p>
          <dl className="space-y-1 text-copy text-neutral-600 dark:text-neutral-400">
            <div>
              <dt className="inline font-medium text-neutral-800 dark:text-neutral-200">Trigger: </dt>
              <dd className="inline">{motions[0].trigger_summary}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-800 dark:text-neutral-200">Personas: </dt>
              <dd className="inline">
                {motions[0].primary_persona} · {motions[0].secondary_persona}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-800 dark:text-neutral-200">CTA: </dt>
              <dd className="inline">{motions[0].cta}</dd>
            </div>
          </dl>
          {assets.length > 0 && (
            <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <h3 className="mb-2 text-copy font-semibold uppercase tracking-wide text-neutral-500">
                Campaign assets
              </h3>
              {assets.map((a) => (
                <details key={a.asset_type} className="mb-2">
                  <summary className="cursor-pointer text-copy font-medium hover:underline">
                    {a.title}
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-inner bg-neutral-50 p-3 font-sans text-copy leading-relaxed dark:bg-neutral-950">
                    {a.content}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <BlockLabel>
            Timeline
          </BlockLabel>
          <ul className="space-y-1.5">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-copy text-neutral-600 dark:text-neutral-400">
                <span className="font-medium">{e.event_type.replace(/_/g, " ").toLowerCase()}</span>
                <span className="ml-auto text-body text-neutral-400">
                  {new Date(e.occurred_at).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
