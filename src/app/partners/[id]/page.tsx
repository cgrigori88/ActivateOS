import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { BackLink, Bento, Card, PageHeader, StatusBadge } from "@/components/ui";
import { partnerRoom } from "@/lib/partners/hub";
import { OVERLAP_LEVELS, LEVEL_LABEL, type RungState } from "@/lib/partnerships/overlap";

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

export default async function PartnerRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const room = await partnerRoom(pool, orgId, id);
  if (!room) notFound();
  const { partner, hub, book, partnership, ladder, grants, pursuits, settlement, scorecard } = room;
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
