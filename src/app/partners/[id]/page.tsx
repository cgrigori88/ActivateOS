import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { BackLink, Bento, Card, PageHeader, StatusBadge } from "@/components/ui";
import { partnerRoom } from "@/lib/partners/hub";
import { OVERLAP_LEVELS, LEVEL_LABEL, type RungState } from "@/lib/partnerships/overlap";
import { decideIntroAction, requestIntroAction, savePlaybookAction } from "../actions";
import { loadPartnerPlaybook } from "@/lib/playbooks/playbooks";

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
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

export default async function PartnerRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ intro?: string; playbook?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const room = await partnerRoom(pool, orgId, id);
  if (!room) notFound();
  const playbook = await loadPartnerPlaybook(pool, orgId, id);
  const { partner, hub, book, partnership, ladder, grants, pursuits, settlement, scorecard, intros, introEligible, contactOptions } = room;
  const awaitingIntros = intros.filter((w) => w.awaitingYou);
  const otherIntros = intros.filter((w) => !w.awaitingYou);
  const encName = encodeURIComponent(partner.name);

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
        <Bento label="sourced revenue" value={money(scorecard.sourcedUsd)} subs={["deal-registered"]} />
        <Bento label="influenced revenue" value={money(scorecard.influencedUsd)} subs={["jointly pursued"]} />
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
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet/12 text-[11px] font-bold text-violet dark:text-violet-300">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{LEVEL_LABEL[level]}</span>
                  {rungChip(ladder.rungs[level].state)}
                </li>
              ))}
            </ol>
          )}
          {ladder && ladder.rungs.named.state === "approved" && (
            <p className="mt-3 text-[11.5px] text-neutral-500">
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
                  <span className="text-[11px] text-neutral-400">{g.direction}</span>
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
                    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10.5px] font-bold text-accent dark:text-blue-300">
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
                    <span className="text-[11px] text-neutral-400">{w.mine ? "you asked" : `${w.otherOrgName ?? "they"} asked`}</span>
                    <StatusBadge status={w.status === "accepted" ? "approved" : w.status === "declined" ? "rejected" : w.status} />
                    <span className="ml-auto text-[11px] text-neutral-400">{w.decidedAt ?? w.createdAt}</span>
                  </div>
                  {w.status === "accepted" && w.revealedContact && (
                    <p className="mt-1 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[13px] text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                      Meet <span className="font-semibold">{w.revealedContact.name}</span>
                      {w.revealedContact.title ? ` — ${w.revealedContact.title}` : ""} ·{" "}
                      <span className="font-mono text-[12px]">{w.revealedContact.email}</span>
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
                    <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
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

      {/* ── Execution with this partner (your tenant's own work) ── */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Execution</h2>
      <div className="mb-2 flex flex-wrap gap-3">
        <Bento label="motions" value={hub.motionsTotal} subs={[`${hub.motionsActive} active`]} href={`/motions?partner=${encName}`} />
        <Bento label="campaigns" value={hub.campaignsTotal} subs={[`${hub.campaignsLive} live`]} href={`/campaigns?partner=${encName}`} />
        <Bento label="touches sent" value={hub.touchesSent} href="/analytics" />
        <Bento label="open pipeline" value={money(hub.pipelineUsd)} subs={[`${hub.oppsOpen} opportunities`]} href="/pipeline" />
        <Bento label="won" value={money(hub.wonUsd)} subs={[`${hub.oppsWon} closed-won`]} href="/pipeline" />
        <Bento label="accounts" value={hub.populations} subs={["approved lists"]} href={`/accounts?partner=${encName}`} />
      </div>
    </main>
  );
}
