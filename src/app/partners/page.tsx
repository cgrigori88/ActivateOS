import Link from "next/link";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { Bento, Card, PageHeader } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { listPartnerRooms } from "@/lib/partners/hub";

export const dynamic = "force-dynamic";

/**
 * Partner Hub index (B+1): every partner as a room you can walk into. The
 * connected ones (live partnership) float up; each card carries just enough
 * to know whether the relationship is working — the room has the rest.
 */

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n > 0 ? `$${Math.round(n / 1000)}k` : "$0";

export default async function PartnersPage() {
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const partners = await listPartnerRooms(pool, orgId);
  const connected = partners.filter((p) => p.partnershipStatus === "active");
  const openPursuits = partners.reduce((s, p) => s + p.openPursuits, 0);
  const settledTotal = partners.reduce((s, p) => s + p.settledUsd, 0);
  const activeMotions = partners.reduce((s, p) => s + p.motionsActive, 0);

  return (
    <main>
      <PageHeader
        title="Partners"
        subtitle="One room per partner — their book, the trust ladder, shared lists, joint rooms, and what has actually settled."
      />
      <RoomTabs tabs={[{ href: "/partners", label: "Partners" }, { href: "/joint", label: "Joint pursuits" }]} />

      <div className="mb-6 flex flex-wrap gap-3">
        <Bento label="partners" value={partners.length} />
        <Bento label="connected tenants" value={connected.length} subs={["live partnership"]} />
        <Bento label="open joint rooms" value={openPursuits} href="/joint" />
        <Bento label="settled joint revenue" value={money(settledTotal)} />
        <Bento label="active partner motions" value={activeMotions} href="/motions" />
      </div>

      {partners.length === 0 && (
        <Card muted>
          <p className="text-sm text-neutral-500">
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
                  <span className="shrink-0 rounded-full bg-violet/12 px-2.5 py-0.5 text-[11px] font-bold text-violet dark:text-violet-300">
                    connected
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-neutral-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-500">
                    {p.partnershipStatus ?? "not connected"}
                  </span>
                )}
              </div>
              <p className="mb-3 truncate text-xs text-neutral-500">
                {[p.partnerType, p.otherOrgName ? `tenant: ${p.otherOrgName}` : null].filter(Boolean).join(" · ") || "—"}
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="tnum text-lg font-extrabold leading-none">{p.bookAccounts}</div>
                  <div className="mt-1 text-[10.5px] font-semibold text-neutral-500">book accounts</div>
                </div>
                <div>
                  <div className="tnum text-lg font-extrabold leading-none">{p.openPursuits}</div>
                  <div className="mt-1 text-[10.5px] font-semibold text-neutral-500">joint rooms</div>
                </div>
                <div>
                  <div className="tnum text-lg font-extrabold leading-none">{money(p.settledUsd)}</div>
                  <div className="mt-1 text-[10.5px] font-semibold text-neutral-500">settled</div>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-neutral-400">
                {p.bookLists} list{p.bookLists === 1 ? "" : "s"} · {p.motionsActive} active motion
                {p.motionsActive === 1 ? "" : "s"} · {p.motionsWon} won
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
