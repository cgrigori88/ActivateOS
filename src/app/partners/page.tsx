import Link from "next/link";
import { Bento, Card, NextStep, PageHeader } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { listPartnerRooms } from "@/lib/partners/hub";
import { partnerActivationHeadlines } from "@/lib/partners/intelligence";
import { withTenant } from "@/lib/db/tenant";
import { formatMoney } from "@/lib/format/money";

export const dynamic = "force-dynamic";

/**
 * Partner Hub index (B+1): every partner as a room you can walk into. The
 * connected ones (live partnership) float up; each card carries just enough
 * to know whether the relationship is working — the room has the rest.
 */

const money = (n: number) => formatMoney(n);

export default async function PartnersPage({
  searchParams,
}: {
  searchParams?: Promise<{ welcome?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const { partners, headlines } = await withTenant(async (db, orgId) => ({
    partners: await listPartnerRooms(db, orgId),
    // Activation headlines (P1B.3): presence vs activation vs execution, per partner — separate
    // truths on one chip row, no composite score.
    headlines: await partnerActivationHeadlines(db, orgId),
  }));
  const headlineBy = new Map(headlines.map((h) => [h.partnerId, h]));
  const connected = partners.filter((p) => p.partnershipStatus === "active");
  const openPursuits = partners.reduce((s, p) => s + p.openPursuits, 0);
  const settledTotal = partners.reduce((s, p) => s + p.settledUsd, 0);
  const activeMotions = partners.reduce((s, p) => s + p.motionsActive, 0);

  return (
    <main>
      <PageHeader
        title="Partners"
        subtitle="One room per partner — their book, the ladder, and what has settled."
      />
      <RoomTabs tabs={[{ href: "/partners", label: "Partners" }, { href: "/joint", label: "Joint pursuits" }]} />

      {/* Next-step pull after a /join redemption (B+2): the partnership is
          live — climbing the disclosure ladder is what makes it real. */}
      {(sp.welcome === "guest" || sp.welcome === "connected") && (
        <NextStep
          message={
            sp.welcome === "guest"
              ? "Your workspace is ready, and the partnership is live. Nothing is shared yet — the trust ladder is how that changes, one approved rung at a time."
              : "Partnership active. Nothing new is shared yet — the trust ladder is where disclosure starts."
          }
          href="/admin"
          cta="Open the trust ladder"
        />
      )}

      <div className="mb-6 flex flex-wrap gap-3">
        <Bento label="partners" value={partners.length} />
        <Bento label="connected tenants" value={connected.length} subs={["live partnership"]} />
        <Bento label="open joint rooms" value={openPursuits} href="/joint" />
        <Bento label="settled joint revenue" value={money(settledTotal)} />
        <Bento label="active partner motions" value={activeMotions} href="/motions" />
      </div>

      {partners.length === 0 && (
        <Card muted>
          <p className="text-copy text-neutral-500">
            No partners yet. Partners are created on Intake when a book arrives, or inline wherever a partner is
            chosen — each one gets a room here.
          </p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {partners.map((p) => (
          <Link key={p.id} href={`/partners/${p.id}`} className="pos-lift block">
            <Card className="h-full">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h2 className="truncate font-semibold">{p.name}</h2>
                {p.partnershipStatus === "active" ? (
                  <span className="shrink-0 rounded-full bg-violet/12 px-2.5 py-0.5 text-label font-bold text-violet dark:text-violet-300">
                    connected
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-neutral-500/10 px-2.5 py-0.5 text-label font-semibold text-neutral-500">
                    {p.partnershipStatus ?? "not connected"}
                  </span>
                )}
              </div>
              <p className="mb-3 truncate text-body text-neutral-500">
                {[p.partnerType, p.otherOrgName ? `tenant: ${p.otherOrgName}` : null].filter(Boolean).join(" · ") || "—"}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="tnum text-section font-extrabold leading-none">{p.bookAccounts}</div>
                  <div className="mt-1 text-micro font-semibold text-neutral-500">book accounts</div>
                </div>
                <div>
                  <div className="tnum text-section font-extrabold leading-none">{p.openPursuits}</div>
                  <div className="mt-1 text-micro font-semibold text-neutral-500">joint rooms</div>
                </div>
                <div>
                  <div className="tnum text-section font-extrabold leading-none">{money(p.settledUsd)}</div>
                  <div className="mt-1 text-micro font-semibold text-neutral-500">settled</div>
                </div>
              </div>
              <p className="mt-3 text-label text-neutral-400">
                {p.bookLists} list{p.bookLists === 1 ? "" : "s"} · {p.motionsActive} active motion
                {p.motionsActive === 1 ? "" : "s"} · {p.motionsWon} won
              </p>
              {(() => { const h = headlineBy.get(p.id); if (!h) return null; return (
                <p className="mt-1.5 text-label">
                  <span className="text-neutral-500">activation:</span>{" "}
                  <span className="font-semibold">{h.overlap} overlap → {h.selected} selected → {h.accepted} accepted</span>
                  {h.pending > 0 && <span className="font-semibold" style={{ color: "var(--color-timing)" }}> · {h.pending} pending</span>}
                  {h.sample > 0 && <span style={{ color: "var(--color-accent-verified)" }}> · {h.won} won (canonical)</span>}
                </p>
              ); })()}
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
