import type { Pool, PoolClient } from "pg";
import { audit } from "./partnerships";
import { namedOverlapAccounts } from "./joint";

type Db = Pool | PoolClient;

/**
 * Warm-intro requests — the ecosystem-qualified lead (B+3, task #82).
 *
 * Consent chain mirrors joint pursuits: active partnership → approved NAMED
 * overlap → an intro may be requested only on an account both sides already
 * know they share. The DECISION is the disclosure: accepting reveals exactly
 * one contact — the accepting side picks which — snapshotted into the row so
 * both tenants read the identical record forever. Declining reveals nothing.
 * Every step lands in both audit ledgers.
 */

interface PartnershipRow {
  id: string;
  initiator_org_id: string;
  counterpart_org_id: string | null;
  status: string;
}

async function loadPartnership(db: Db, partnershipId: string): Promise<PartnershipRow> {
  const { rows } = await db.query<PartnershipRow>(
    `select id, initiator_org_id, counterpart_org_id, status from partnerships where id = $1`,
    [partnershipId],
  );
  if (!rows[0]) throw new Error("Partnership not found.");
  return rows[0];
}

function memberOrgs(p: PartnershipRow): string[] {
  return [p.initiator_org_id, p.counterpart_org_id].filter(Boolean) as string[];
}

export interface RevealedContact {
  name: string;
  title: string | null;
  email: string;
}

export interface WarmIntroView {
  id: string;
  partnershipId: string;
  companyId: string;
  accountName: string;
  ask: string;
  status: "requested" | "accepted" | "declined";
  requestedByOrg: string;
  otherOrgName: string | null;
  /** True when the viewer's side still owes the decision. */
  awaitingYou: boolean;
  /** True when the viewer sent it. */
  mine: boolean;
  revealedContact: RevealedContact | null;
  createdAt: string;
  decidedAt: string | null;
}

export async function requestWarmIntro(
  db: Db,
  orgId: string,
  partnershipId: string,
  companyId: string,
  ask: string,
): Promise<string> {
  const p = await loadPartnership(db, partnershipId);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (p.status !== "active") throw new Error("Warm intros need an active partnership.");
  const cleanAsk = ask.trim().slice(0, 500);
  if (!cleanAsk) throw new Error("Say who you hope to reach and why — the partner sees it verbatim.");

  // Same disclosure gate as joint pursuits: named-overlap accounts only.
  const eligible = await namedOverlapAccounts(db, partnershipId);
  const account = eligible.find((a) => a.company_id === companyId);
  if (!account) {
    throw new Error(
      "That account isn't in this partnership's approved named overlap — run the blind-overlap ladder to the named rung first.",
    );
  }

  // One open request per account per partnership; a decline may be re-asked.
  const { rows: existing } = await db.query<{ status: string }>(
    `select status from warm_intro_requests
     where partnership_id = $1 and company_id = $2 and status in ('requested', 'accepted')`,
    [partnershipId, companyId],
  );
  if (existing[0]) {
    throw new Error(`A warm-intro request on this account is already ${existing[0].status}.`);
  }

  const { rows } = await db.query<{ id: string }>(
    `insert into warm_intro_requests (partnership_id, company_id, requested_by_org, ask)
     values ($1, $2, $3, $4) returning id`,
    [partnershipId, companyId, orgId, cleanAsk],
  );
  for (const org of memberOrgs(p)) {
    await audit(db, org, "intro.requested", { account: account.name, by: org === orgId ? "us" : "counterpart" }, p.id);
  }
  return rows[0].id;
}

/**
 * Counterpart decision. Accepting requires choosing one of the decider's OWN
 * contacts on that account — the reveal is explicit, singular, and theirs to
 * make. The snapshot (not a live reference) is what both sides see.
 */
export async function decideWarmIntro(
  db: Db,
  orgId: string,
  requestId: string,
  accept: boolean,
  contactId?: string,
): Promise<void> {
  const { rows } = await db.query<{
    id: string; partnership_id: string; company_id: string; requested_by_org: string; status: string;
  }>(
    `select id, partnership_id, company_id, requested_by_org, status
     from warm_intro_requests where id = $1`,
    [requestId],
  );
  const req = rows[0];
  if (!req) throw new Error("Request not found.");
  if (req.status !== "requested") throw new Error(`This request is already ${req.status}.`);

  const p = await loadPartnership(db, req.partnership_id);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (req.requested_by_org === orgId) throw new Error("The requesting side can't decide its own request.");

  let revealed: RevealedContact | null = null;
  if (accept) {
    if (!contactId) throw new Error("Pick which of your contacts to introduce.");
    const { rows: contact } = await db.query<{ name: string | null; title: string | null; email: string }>(
      `select name, title, email from contacts
       where id = $1 and org_id = $2 and company_id = $3`,
      [contactId, orgId, req.company_id],
    );
    if (!contact[0]) throw new Error("That contact isn't yours on this account.");
    revealed = { name: contact[0].name ?? contact[0].email, title: contact[0].title, email: contact[0].email };
  }

  await db.query(
    `update warm_intro_requests
     set status = $2, revealed_contact = $3, decided_at = now()
     where id = $1`,
    [requestId, accept ? "accepted" : "declined", revealed ? JSON.stringify(revealed) : null],
  );

  const { rows: acct } = await db.query<{ legal_name: string }>(`select legal_name from companies where id = $1`, [req.company_id]);
  for (const org of memberOrgs(p)) {
    await audit(
      db,
      org,
      accept ? "intro.accepted" : "intro.declined",
      { account: acct[0]?.legal_name ?? req.company_id, by: org === orgId ? "us" : "counterpart" },
      p.id,
    );
  }
}

export async function listWarmIntros(db: Db, orgId: string, partnershipId?: string): Promise<WarmIntroView[]> {
  const { rows } = await db.query<{
    id: string; partnership_id: string; company_id: string; legal_name: string;
    ask: string; status: WarmIntroView["status"]; requested_by_org: string;
    revealed_contact: RevealedContact | null; created_at: Date; decided_at: Date | null;
    other_name: string | null;
  }>(
    `select w.id, w.partnership_id, w.company_id, c.legal_name, w.ask, w.status,
            w.requested_by_org, w.revealed_contact, w.created_at, w.decided_at,
            (select o.name from organizations o
             where o.id = case when p.initiator_org_id = $1 then p.counterpart_org_id else p.initiator_org_id end) as other_name
     from warm_intro_requests w
     join partnerships p on p.id = w.partnership_id
     join companies c on c.id = w.company_id
     where (p.initiator_org_id = $1 or p.counterpart_org_id = $1)
       and ($2::uuid is null or w.partnership_id = $2)
     order by (w.status = 'requested') desc, w.created_at desc`,
    [orgId, partnershipId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    partnershipId: r.partnership_id,
    companyId: r.company_id,
    accountName: r.legal_name,
    ask: r.ask,
    status: r.status,
    requestedByOrg: r.requested_by_org,
    otherOrgName: r.other_name,
    awaitingYou: r.status === "requested" && r.requested_by_org !== orgId,
    mine: r.requested_by_org === orgId,
    revealedContact: r.revealed_contact,
    createdAt: new Date(r.created_at).toISOString().slice(0, 10),
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString().slice(0, 10) : null,
  }));
}
