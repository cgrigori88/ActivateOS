import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db/tenant";
import { BackLink, Bento, Card, PageHeader, StatusBadge } from "@/components/ui";
import { partnerRoom } from "@/lib/partners/hub";
import { getObservedActivationPattern, getPartnerActivationProfile } from "@/lib/partners/intelligence";
import { ActivationProfile } from "@/components/partners/activation-profile";
import { OVERLAP_LEVELS, LEVEL_LABEL, type RungState } from "@/lib/partnerships/overlap";
import { createInitiativeAction, decideEvidenceShareAction, decideIntroAction, decideSkillShareAction, offerEvidenceShareAction, offerSkillShareAction, requestIntroAction, revokeEvidenceShareAction, revokeSkillShareAction, savePlaybookAction, setInitiativeStatusAction } from "../actions";
import { loadPartnerPlaybook } from "@/lib/playbooks/playbooks";
import { listInitiatives } from "@/lib/partnerships/initiatives";
import { listEvidenceShares, offerableEvidence, type EvidenceShareView } from "@/lib/partnerships/evidence-shares";
import { listSkillShares, type SkillShareView } from "@/lib/skills/skills";

export const dynamic = "force-dynamic";

/**
 * The partner room (B+1): where you WORK one partner. Reads everything —
 * book, ladder, shared lists, joint rooms, settlement, scorecard — and links
 * into the room where each thing is decided (Admin governs, Mapping builds,
 * Joint executes). Nothing here mutates.
 */

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n > 0 ? `$${Math.round(n / 1000)}k` : "$0";

function rungChip(state: RungState["state"]) {
  const styles: Record<string, string> = {
    approved: "bg-emerald/12 text-emerald dark:text-emerald-300",
    awaiting_you: "bg-accent/12 text-accent dark:text-blue-300",
    requested_by_us: "bg-amber/14 text-amber dark:text-amber-300",
    declined: "bg-rose/12 text-rose dark:text-rose-300",
    available: "bg-neutral-500/10 text-neutral-500",
    locked: "bg-neutral-500/10 text-neutral-400 dark:text-neutral-600",
  };
  const labels: Record<string, string> = {
    approved: "approved",
    awaiting_you: "awaiting you",
    requested_by_us: "requested",
    declined: "declined",
    available: "available",
    locked: "locked",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-label font-bold ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

export default async function PartnerRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ intro?: string; playbook?: string; initiative?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const { room, profile, pattern, playbook, initiatives, skillShares, evidenceShares, offerableClaims, shareableSkills } = await withTenant(async (db, orgId) => {
    const room = await partnerRoom(db, orgId, id);
    if (!room) notFound();
    return {
      room,
      // Activation intelligence (P1B) — presence/relationship/activation/execution as separate truths.
      profile: await getPartnerActivationProfile(db, orgId, id),
      // "Where should I use this partner?" (§5) — observed pattern from existing evidence only.
      pattern: await getObservedActivationPattern(db, orgId, id),
      playbook: await loadPartnerPlaybook(db, orgId, id),
      initiatives: await listInitiatives(db, orgId, { partnerId: id }),
      // Skill sharing (task #85): both directions on this partnership, plus the
      // skills of ours that could still be offered.
      skillShares: (room.partnership ? await listSkillShares(db, orgId, room.partnership.id) : []) as SkillShareView[],
      evidenceShares: (room.partnership?.status === "active" ? await listEvidenceShares(db, orgId, room.partnership.id) : []) as EvidenceShareView[],
      offerableClaims: room.partnership?.status === "active" ? await offerableEvidence(db, orgId, room.partnership.id) : [],
      shareableSkills: room.partnership?.status === "active"
        ? (await db.query<{ id: string; name: string; kind: string }>(
            `select s.id, s.name, s.kind from skills s
         where s.org_id = $1 and s.status = 'active'
           and (s.scope_type = 'org' or (s.scope_type = 'partner' and s.scope_id = $2))
           and not exists (select 1 from skill_shares sh
                           where sh.skill_id = s.id and sh.partnership_id = $3 and sh.status in ('offered', 'accepted'))
         order by s.name`,
            [orgId, id, room.partnership.id],
          )).rows
        : [],
    };
  });
  const { partner, hub, book, partnership, ladder, grants, pursuits, settlement, scorecard, intros, introEligible, contactOptions } = room;
  const awaitingIntros = intros.filter((w) => w.awaitingYou);
  const otherIntros = intros.filter((w) => !w.awaitingYou);
  const encName = encodeURIComponent(partner.name);

  // Decisions waiting inside partnership operations — counted on the Manage summary and
  // auto-opening it, so progressive disclosure never hides something awaiting a human.
  const pendingDecisions =
    awaitingIntros.length +
    skillShares.filter((s) => s.direction === "incoming" && s.status === "offered").length +
    evidenceShares.filter((s) => s.direction === "incoming" && s.status === "offered").length +
    pursuits.filter((x) => x.awaitingYou).length +
    (ladder ? OVERLAP_LEVELS.filter((l) => ladder.rungs[l].state === "awaiting_you").length : 0);
  const manageOpen = pendingDecisions > 0 || sp.intro != null || sp.playbook != null || sp.initiative != null;

  const meta = [
    partner.partnerType,
    partner.industries?.length ? partner.industries.slice(0, 3).join(", ") : null,
    partnership?.otherOrgName ? `connected tenant: ${partnership.otherOrgName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main>
      <div className="mb-3">
        <BackLink href="/partners" label="Partners" />
      </div>
      <PageHeader title={partner.name} subtitle={meta || undefined} />

      {/* ── Commercial intelligence first (UX normalization §4): the viewport answers
          presence, activation, responsiveness, execution, outcomes, what's waiting, and
          where to activate — before any administration. ── */}
      {profile && <ActivationProfile p={profile} pattern={pattern} />}

      {/* ── Scorecard v1: settlement truth, not self-reporting ── */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Scorecard</h2>
      <div className="mb-6 flex flex-wrap gap-3">
        <Bento
          label="joint win rate"
          value={scorecard.jointWinRate == null ? "—" : `${scorecard.jointWinRate}%`}
          subs={[scorecard.settledN + scorecard.lostN > 0 ? `${scorecard.settledN} won · ${scorecard.lostN} lost` : "no settled joint deals yet"]}
        />
        <Bento
          label="avg joint cycle"
          value={scorecard.avgCycleDays == null ? "—" : `${scorecard.avgCycleDays}d`}
          subs={["open → closed-won"]}
        />
        <Bento label="sourced revenue" value={money(scorecard.sourcedUsd)} subs={["registration-based (settlement)"]} />
        <Bento label="influenced revenue" value={money(scorecard.influencedUsd)} subs={["registration-based (settlement)"]} />
        <Bento
          label="responsiveness"
          value={scorecard.responsivenessDays == null ? "—" : scorecard.responsivenessDays < 1 ? "<1d" : `${Math.round(scorecard.responsivenessDays)}d`}
          subs={["pursuit proposal → decision"]}
        />
        <Bento
          label="motion win rate"
          value={scorecard.motionWinRate == null ? "—" : `${scorecard.motionWinRate}%`}
          subs={[`your motions with ${partner.name}`]}
        />
      </div>

      {/* ── Execution with this partner (your tenant's own work) — intelligence, so it stays in the first tier ── */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Execution</h2>
      <div className="mb-6 flex flex-wrap gap-3">
        <Bento label="motions" value={hub.motionsTotal} subs={[`${hub.motionsActive} active`]} href={`/motions?partner=${encName}`} />
        <Bento label="campaigns" value={hub.campaignsTotal} subs={[`${hub.campaignsLive} live`]} href={`/campaigns?partner=${encName}`} />
        <Bento label="touches sent" value={hub.touchesSent} href="/analytics" />
        <Bento label="open pipeline" value={money(hub.pipelineUsd)} subs={[`${hub.oppsOpen} opportunities`]} href="/pipeline" />
        <Bento label="won" value={money(hub.wonUsd)} subs={[`${hub.oppsWon} closed-won`]} href="/pipeline" />
        <Bento label="accounts" value={hub.populations} subs={["approved lists"]} href={`/accounts?partner=${encName}`} />
      </div>

      {/* ── Partnership operations (UX normalization §4): everything you administer — targets,
          disclosure, sharing, playbook, settlement — under one progressive disclosure. Every
          capability is intact; it opens itself whenever a decision is waiting. ── */}
      <details open={manageOpen} className="mb-6">
        <summary className="pos-card mb-4 flex cursor-pointer items-baseline gap-3 rounded-card px-4 py-3 text-sm font-semibold">
          Manage partnership
          <span className="min-w-0 flex-1 truncate text-xs font-normal text-neutral-500">
            initiatives · trust ladder · their book · shared lists · joint rooms · intros · playbook · evidence &amp; skills · settlement
          </span>
          {pendingDecisions > 0 && (
            <span className="shrink-0 rounded-full bg-accent/12 px-2.5 py-0.5 text-label font-bold text-accent dark:text-blue-300">
              {pendingDecisions} decision{pendingDecisions === 1 ? "" : "s"} waiting
            </span>
          )}
        </summary>

      {/* ── Initiatives (task #83): named targets that real activity rolls up
          into. The anti-pattern this replaces: the partner-plan document whose
          initiatives read Target $10M / Won $0 forever because nothing links
          deals to them. Progress here is computed, never reported. ── */}
      <Card className="mb-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Initiatives</h2>
          <span className="flex items-baseline gap-3 text-xs">
            <span className="text-neutral-400">targets the pipeline moves — nothing here is self-reported</span>
            <Link href={`/partners/${partner.id}/review`} className="whitespace-nowrap font-medium text-accent hover:underline dark:text-blue-400" title="the document version — every figure pulled live, printable for whoever still wants a PDF">
              Partnership review →
            </Link>
          </span>
        </div>
        {sp.initiative && sp.initiative !== "created" && (
          <p className="mb-3 rounded-lg bg-amber/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{sp.initiative}</p>
        )}
        {sp.initiative === "created" && (
          <p className="mb-3 rounded-lg bg-emerald/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            Initiative created — attach motions, campaigns, and opportunities and the rollup moves on its own.
          </p>
        )}
        {initiatives.length === 0 && (
          <p className="mb-3 text-sm text-neutral-500">
            No initiatives with {partner.name} yet. Name the play, give it a number, and let the pipeline report the progress.
          </p>
        )}
        <div className="space-y-3">
          {initiatives.map((init) => {
            const denom = init.targetUsd && init.targetUsd > 0 ? init.targetUsd : null;
            const wonPct = denom ? Math.min(100, Math.round((init.wonUsd / denom) * 100)) : null;
            const openPct = denom ? Math.min(100 - (wonPct ?? 0), Math.round((init.openUsd / denom) * 100)) : null;
            return (
              <div key={init.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">{init.name}</span>
                  {init.periodLabel && <span className="text-xs text-neutral-400">{init.periodLabel}</span>}
                  {init.status !== "active" && <StatusBadge status={init.status} />}
                  <span className="tnum ml-auto text-sm text-neutral-500">
                    {init.targetUsd != null ? `target ${money(init.targetUsd)}` : "no target set"}
                  </span>
                </div>
                {init.description && <p className="mt-1 text-sm text-neutral-500">{init.description}</p>}
                {denom != null && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800" title={`won ${money(init.wonUsd)} · open ${money(init.openUsd)} · target ${money(denom)}`}>
                    <div className="flex h-full">
                      <div className="bg-emerald" style={{ width: `${wonPct}%` }} />
                      <div className="bg-accent/50" style={{ width: `${openPct}%` }} />
                    </div>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <span className="tnum"><b className="text-emerald-700 dark:text-emerald-400">{money(init.wonUsd)}</b> won ({init.wonN})</span>
                  <span className="tnum"><b className="text-accent dark:text-blue-400">{money(init.openUsd)}</b> registered ({init.openN} open)</span>
                  {init.lostN > 0 && <span className="tnum"><b className="text-rose-700 dark:text-rose-400">{money(init.lostUsd)}</b> lost ({init.lostN})</span>}
                  <span>{init.motions} motion{init.motions === 1 ? "" : "s"} · {init.campaigns} campaign{init.campaigns === 1 ? "" : "s"}</span>
                  <span className="ml-auto flex gap-2">
                    {init.status === "active" && (
                      <form action={setInitiativeStatusAction.bind(null, partner.id, init.id, "completed")}>
                        <button className="text-neutral-400 underline-offset-2 hover:underline">mark complete</button>
                      </form>
                    )}
                    {init.status !== "archived" ? (
                      <form action={setInitiativeStatusAction.bind(null, partner.id, init.id, "archived")}>
                        <button className="text-neutral-400 underline-offset-2 hover:underline">archive</button>
                      </form>
                    ) : (
                      <form action={setInitiativeStatusAction.bind(null, partner.id, init.id, "active")}>
                        <button className="text-neutral-400 underline-offset-2 hover:underline">restore</button>
                      </form>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <form action={createInitiativeAction.bind(null, partner.id)} className="mt-4 grid gap-2 md:grid-cols-[1fr_140px_120px_auto]">
          <input
            name="name"
            required
            placeholder={`e.g. FY27 automation push — ${partner.name}`}
            className="rounded-lg border border-neutral-200 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-800"
          />
          <input
            name="target"
            inputMode="numeric"
            placeholder="target $"
            className="rounded-lg border border-neutral-200 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-800"
          />
          <input
            name="period"
            placeholder="period (FY27)"
            className="rounded-lg border border-neutral-200 bg-transparent px-3 py-1.5 text-sm dark:border-neutral-800"
          />
          <button className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">Add initiative</button>
          <input
            name="description"
            placeholder="what winning looks like (optional)"
            className="rounded-lg border border-neutral-200 bg-transparent px-3 py-1.5 text-sm md:col-span-4 dark:border-neutral-800"
          />
        </form>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* ── Trust ladder (read-only; Admin decides) ── */}
        <Card tone="violet">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Trust ladder</h2>
            {partnership?.status === "active" && (
              <Link href="/admin" className="text-xs font-semibold text-accent hover:underline dark:text-blue-300">
                Decide on Admin →
              </Link>
            )}
          </div>
          {!partnership && (
            <p className="text-sm text-neutral-500">
              Not connected — invite this partner&apos;s org from{" "}
              <Link href="/admin" className="text-accent hover:underline dark:text-blue-300">Admin</Link> to climb the
              disclosure ladder together. Until then this room shows only your own side.
            </p>
          )}
          {partnership && partnership.status !== "active" && (
            <p className="text-sm text-neutral-500">
              Partnership {partnership.status} — the ladder needs an active partnership.
            </p>
          )}
          {ladder && (
            <ol className="space-y-2">
              {OVERLAP_LEVELS.map((level, i) => (
                <li key={level} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet/12 text-label font-bold text-violet dark:text-violet-300">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{LEVEL_LABEL[level]}</span>
                  {rungChip(ladder.rungs[level].state)}
                </li>
              ))}
            </ol>
          )}
          {ladder && ladder.rungs.named.state === "approved" && (
            <p className="mt-3 text-label text-neutral-500">
              Named overlap approved — joint rooms can open on any shared account.{" "}
              <Link href="/joint" className="text-accent hover:underline dark:text-blue-300">Propose one →</Link>
            </p>
          )}
        </Card>

        {/* ── Their book (your imported copy) ── */}
        <Card>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Their book</h2>
            <Link href="/mapping" className="text-xs font-semibold text-accent hover:underline dark:text-blue-300">
              Work it on Mapping →
            </Link>
          </div>
          {book.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No lists from this partner yet —{" "}
              <Link href="/intake" className="text-accent hover:underline dark:text-blue-300">bring a book in</Link>.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {book.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="tnum text-xs text-neutral-500">{l.members}</span>
                  <StatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Shared lists (grants both ways) ── */}
        <Card>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Shared lists</h2>
            {partnership?.status === "active" && (
              <Link href="/admin" className="text-xs font-semibold text-accent hover:underline dark:text-blue-300">
                Share on Admin →
              </Link>
            )}
          </div>
          {grants.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {partnership?.status === "active"
                ? "Nothing shared in either direction yet."
                : "List sharing needs an active partnership."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {grants.map((g) => (
                <li key={g.id} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="shrink-0 text-neutral-400">{g.direction === "outgoing" ? "↗" : "↙"}</span>
                  <span className="min-w-0 flex-1 truncate">{g.listName}</span>
                  <span className="text-label text-neutral-400">{g.direction}</span>
                  <StatusBadge status={g.status === "offered" ? "draft" : g.status === "accepted" ? "active" : g.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Joint rooms ── */}
        <Card tone="violet">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Joint rooms</h2>
            <Link href="/joint" className="text-xs font-semibold text-accent hover:underline dark:text-blue-300">
              All joint pursuits →
            </Link>
          </div>
          {pursuits.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {partnership?.status === "active"
                ? "No rooms with this partner yet — an approved named overlap unlocks them."
                : "Joint rooms need an active partnership."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {pursuits.map((x) => (
                <li key={x.id} className="flex items-center gap-2 text-sm">
                  <Link href={`/joint/${x.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {x.accountName}
                  </Link>
                  {x.awaitingYou && (
                    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-micro font-bold text-accent dark:text-blue-300">
                      awaiting you
                    </span>
                  )}
                  <StatusBadge status={x.status === "proposed" ? "draft" : x.status === "declined" ? "rejected" : x.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Warm intros — the ecosystem-qualified lead (B+3) ── */}
      {partnership?.status === "active" && (
        <Card tone="violet" className="mb-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Warm intros</h2>
          <p className="mb-3 max-w-[88ch] text-xs text-neutral-500">
            Ask {partner.name} for an introduction at any account in the approved named overlap. Accepting is the
            disclosure: they choose which one contact to reveal — nothing else moves.
          </p>

          {sp.intro === "sent" && (
            <div className="mb-3 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              Request sent — {partner.name} sees your ask verbatim and decides.
            </div>
          )}

          {/* Requests waiting on THIS side: the ask verbatim + the reveal choice. */}
          {awaitingIntros.map((w) => (
            <div key={w.id} className="mb-3 rounded-xl border border-accent/40 bg-accent/[0.05] p-4">
              <p className="text-sm">
                <span className="font-semibold">{w.otherOrgName ?? "Your partner"}</span> asks for an intro at{" "}
                <span className="font-semibold">{w.accountName}</span>:
              </p>
              <p className="mt-1 border-l-2 border-accent/40 pl-3 text-sm italic text-neutral-600 dark:text-neutral-300">
                {w.ask}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {(contactOptions[w.companyId] ?? []).length > 0 ? (
                  <form action={decideIntroAction.bind(null, partner.id, w.id, true)} className="flex flex-wrap items-end gap-2">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-neutral-500">Introduce (reveals name, title, email)</span>
                      <select name="contactId" className="w-64 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                        {(contactOptions[w.companyId] ?? []).map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                    <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">Introduce</button>
                  </form>
                ) : (
                  <p className="text-xs text-neutral-500">
                    You have no captured contacts on this account yet — Contacts is where they come from.
                  </p>
                )}
                <form action={decideIntroAction.bind(null, partner.id, w.id, false)}>
                  <button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-100 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-800">
                    Decline
                  </button>
                </form>
              </div>
            </div>
          ))}

          {/* Everything else: sent requests and settled decisions. */}
          {otherIntros.length > 0 && (
            <ul className="mb-3 space-y-2">
              {otherIntros.map((w) => (
                <li key={w.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-medium">{w.accountName}</span>
                    <span className="text-label text-neutral-400">{w.mine ? "you asked" : `${w.otherOrgName ?? "they"} asked`}</span>
                    <StatusBadge status={w.status === "accepted" ? "approved" : w.status === "declined" ? "rejected" : w.status} />
                    <span className="ml-auto text-label text-neutral-400">{w.decidedAt ?? w.createdAt}</span>
                  </div>
                  {w.status === "accepted" && w.revealedContact && (
                    <p className="mt-1 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-body text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                      Meet <span className="font-semibold">{w.revealedContact.name}</span>
                      {w.revealedContact.title ? ` — ${w.revealedContact.title}` : ""} ·{" "}
                      <span className="font-mono text-body">{w.revealedContact.email}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* New request — named-overlap accounts without an open ask. */}
          {introEligible.length > 0 ? (
            <form action={requestIntroAction.bind(null, partner.id, partnership.id)} className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Account (named overlap)</span>
                <select name="companyId" className="w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                  {introEligible.map((a) => (
                    <option key={a.companyId} value={a.companyId}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label className="min-w-64 flex-1 text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Who do you hope to reach, and why? (they see this verbatim)</span>
                <input name="ask" required maxLength={500} placeholder="Trying to reach whoever owns the modernization budget…" className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <button className="rounded-md bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800">Request a warm intro</button>
            </form>
          ) : (
            <p className="text-xs text-neutral-500">
              {ladder?.rungs.named.state === "approved"
                ? "Every named-overlap account already has a request — decisions live above."
                : "Intro requests unlock with the named-accounts rung of the trust ladder."}
            </p>
          )}
        </Card>
      )}

      {/* ── Playbook (task #83): org-private; grounds the AI when this partner is on the pursuit ── */}
      <Card className="mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Playbook</h2>
        <p className="mb-3 text-sm text-neutral-500">
          How your team sells with {partner.name}. Private to your workspace — the motion designer reads
          this whenever {partner.name} is on the pursuit team.
          {playbook?.updatedAt && <span className="text-neutral-400"> Last saved {playbook.updatedAt}.</span>}
        </p>
        {sp.playbook === "saved" && (
          <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Playbook saved — future motions with {partner.name} will draft against it.
          </p>
        )}
        <form action={savePlaybookAction.bind(null, partner.id)} className="grid gap-3 md:grid-cols-3">
          <label className="block text-xs font-medium text-neutral-500">
            Joint positioning
            <textarea
              name="positioning"
              rows={4}
              maxLength={4000}
              defaultValue={playbook?.positioning ?? ""}
              placeholder="What the combined story is — why us + them beats either alone…"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="block text-xs font-medium text-neutral-500">
            Their strengths
            <textarea
              name="strengths"
              rows={4}
              maxLength={4000}
              defaultValue={playbook?.strengths ?? ""}
              placeholder="Where this partner is genuinely strong — segments, geos, relationships, delivery…"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="block text-xs font-medium text-neutral-500">
            Rules of engagement
            <textarea
              name="rules"
              rows={4}
              maxLength={4000}
              defaultValue={playbook?.rules ?? ""}
              placeholder="Who opens, deal registration, accounts that are off-limits, escalation paths…"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <div className="md:col-span-3">
            <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
              Save playbook
            </button>
          </div>
        </form>
      </Card>

      {/* ── Evidence exchange (slice G): consented claim sharing, both ways.
          Only verified claims on the approved NAMED overlap are offerable —
          you cannot leak an account the partner doesn't already share. ── */}
      {partnership?.status === "active" && (
        <Card tone="violet" className="mb-6">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Evidence exchange</h2>
            <span className="text-xs text-neutral-400">verified claims, shared live across the fence — provenance intact, revocable</span>
          </div>
          {evidenceShares.length === 0 && (
            <p className="mb-3 text-sm text-neutral-500">Nothing shared in either direction yet.</p>
          )}
          <ul className="mb-3 space-y-2">
            {evidenceShares.map((sh) => (
              <li key={sh.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-micro font-bold uppercase ${sh.direction === "incoming" ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                  {sh.direction === "incoming" ? "from them" : "from us"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{sh.accountName}</span>
                  <span className="text-neutral-500"> — {sh.claim.length > 140 ? sh.claim.slice(0, 140) + "…" : sh.claim}</span>
                  <span className="ml-1 text-label text-neutral-400">({sh.sourceType}, {sh.observedAt})</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {sh.status === "offered" && sh.direction === "incoming" ? (
                    <>
                      <form action={decideEvidenceShareAction.bind(null, partner.id, sh.id, true)}>
                        <button className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-white">Accept</button>
                      </form>
                      <form action={decideEvidenceShareAction.bind(null, partner.id, sh.id, false)}>
                        <button className="text-xs text-neutral-400 underline-offset-2 hover:underline">decline</button>
                      </form>
                    </>
                  ) : (
                    <StatusBadge status={sh.status} />
                  )}
                  {sh.direction === "outgoing" && sh.status !== "declined" && (
                    <form action={revokeEvidenceShareAction.bind(null, partner.id, sh.id)}>
                      <button className="text-xs text-neutral-400 underline-offset-2 hover:underline">revoke</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {offerableClaims.length > 0 ? (
            <form action={offerEvidenceShareAction.bind(null, partner.id, partnership.id)} className="flex flex-wrap items-center gap-2">
              <select name="evidenceId" className="max-w-[520px] flex-1 rounded-lg border border-neutral-200 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-800">
                {offerableClaims.map((c) => (
                  <option key={c.id} value={c.id}>{c.accountName} — {c.claim.slice(0, 90)}</option>
                ))}
              </select>
              <button className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white">Offer to {partner.name}</button>
              <span className="text-label text-neutral-400">they must accept before it appears in their account room</span>
            </form>
          ) : (
            <p className="text-xs text-neutral-400">No offerable claims — evidence must be verified and on the approved named overlap.</p>
          )}
        </Card>
      )}

      {/* ── Skill sharing (task #85): consent-gated, live-read, audited both sides ── */}
      {room.partnership?.status === "active" && (
        <Card tone="violet" className="mb-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Skill sharing</h2>
          <p className="mb-3 text-sm text-neutral-500">
            Share a skill and {partner.name}&rsquo;s agents follow it on your joint deals — they read it live,
            so your edits (and a revoke) apply instantly. Their offers need your accept before anything grounds.
          </p>

          {skillShares.filter((s) => s.direction === "incoming" && s.status === "offered").map((s) => (
            <div key={s.id} className="mb-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/30">
              <p className="mb-1 text-sm">
                <span className="font-semibold">{s.fromOrgName}</span> offers the skill{" "}
                <span className="font-semibold">&ldquo;{s.skillName}&rdquo;</span>{" "}
                <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-micro font-semibold text-neutral-500">{s.kind}</span>
              </p>
              <p className="mb-2 text-xs text-neutral-500">{s.body.slice(0, 240)}{s.body.length > 240 ? "…" : ""}</p>
              <div className="flex gap-2">
                <form action={decideSkillShareAction.bind(null, partner.id, s.id, true)}>
                  <button className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800">
                    Accept — our agents start following it
                  </button>
                </form>
                <form action={decideSkillShareAction.bind(null, partner.id, s.id, false)}>
                  <button className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900">Decline</button>
                </form>
              </div>
            </div>
          ))}

          {skillShares.some((s) => s.status === "accepted" || s.direction === "outgoing") && (
            <ul className="mb-3 space-y-1">
              {skillShares
                .filter((s) => s.status === "accepted" || s.direction === "outgoing")
                .map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-micro font-semibold uppercase text-neutral-500">
                      {s.direction === "outgoing" ? "yours" : "theirs"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{s.skillName}</span>
                    <span className="text-label text-neutral-400">{s.kind} · {s.status}{s.status === "accepted" ? " — live" : ""}</span>
                    {s.direction === "outgoing" && (
                      <form action={revokeSkillShareAction.bind(null, partner.id, s.id)}>
                        <button className="text-label font-medium text-rose hover:underline">revoke</button>
                      </form>
                    )}
                  </li>
                ))}
            </ul>
          )}

          {shareableSkills.length > 0 ? (
            <form action={offerSkillShareAction.bind(null, partner.id, room.partnership.id)} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Share one of your skills</span>
                <select name="skillId" className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                  {shareableSkills.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>
                  ))}
                </select>
              </label>
              <button className="rounded-md bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800">
                Offer to {partner.name}
              </button>
            </form>
          ) : (
            <p className="border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
              Nothing left to offer — every eligible skill is already shared or pending. Add skills in the{" "}
              <Link className="font-medium text-accent hover:underline" href="/skills">Skills library</Link>.
            </p>
          )}
        </Card>
      )}

      {/* ── Settlement ── */}
      {settlement && (
        <Card className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Settlement</h2>
          {settlement.settled.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Nothing settled yet — {settlement.inFlight.length} opportunit{settlement.inFlight.length === 1 ? "y" : "ies"} in
              flight on jointly pursued accounts.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-sm">
                {Object.entries(settlement.settledTotals).map(([oid, total]) => (
                  <span key={oid}>
                    <span className="font-semibold">{settlement.orgNames[oid] ?? "—"}</span>{" "}
                    <span className="tnum">{money(total)}</span> settled
                  </span>
                ))}
                <span className="text-neutral-500">{settlement.inFlight.length} in flight</span>
              </div>
              <ul className="space-y-1">
                {settlement.settled.slice(0, 8).map((e, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{e.account}</span>
                    <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-micro font-semibold text-neutral-500">
                      {e.attribution}
                    </span>
                    <span className="text-xs text-neutral-400">{e.quarter}</span>
                    <span className="tnum w-16 text-right text-xs font-semibold">{e.amountUsd == null ? "—" : money(e.amountUsd)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      </details>
    </main>
  );
}
