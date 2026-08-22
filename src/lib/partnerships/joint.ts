import type { Pool, PoolClient } from "pg";
import { audit, currentActor } from "./partnerships";
import type { NamedResults } from "./overlap";
import { loadJointPlaybook } from "@/lib/playbooks/playbooks";

type Db = Pool | PoolClient;

/**
 * Joint pursuits (task #74): a co-sell room spanning two tenants.
 *
 * Consent chain: active partnership → approved NAMED overlap rung → propose
 * only on an account in those named results → counterpart accepts. Inside
 * the room, everything is symmetric: events are stored once with org NAMES
 * in the text (never "you/them"), so both sides read the identical ledger.
 *
 * The broker (events with org_id null) composes ONLY from data both sides
 * already consented to — v1 uses the named-overlap categories. That
 * restriction is the room's core invariant: the broker never says anything
 * to one side it doesn't say to both, and never uses anything one side
 * hasn't already agreed the other may know.
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

/** Accounts eligible for a joint pursuit = the approved named-overlap snapshot. */
export async function namedOverlapAccounts(
  db: Db,
  partnershipId: string,
): Promise<NamedResults["accounts"]> {
  const { rows } = await db.query<{ results: NamedResults }>(
    `select results from overlap_probes
     where partnership_id = $1 and level = 'named' and status = 'approved'
     order by decided_at desc limit 1`,
    [partnershipId],
  );
  return rows[0]?.results?.accounts ?? [];
}

async function orgNames(db: Db, ids: string[]): Promise<Record<string, string>> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select id, name from organizations where id = any($1)`,
    [ids],
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

async function addEvent(
  db: Db,
  pursuitId: string,
  orgId: string | null,
  kind: "status" | "note" | "proposal" | "decision",
  body: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const actor = orgId === null ? "broker" : await currentActor();
  await db.query(
    `insert into joint_pursuit_events (pursuit_id, org_id, actor, kind, body, detail)
     values ($1, $2, $3, $4, $5, $6)`,
    [pursuitId, orgId, actor, kind, body, JSON.stringify(detail)],
  );
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function proposeJointPursuit(
  db: Db,
  orgId: string,
  partnershipId: string,
  companyId: string,
): Promise<string> {
  const p = await loadPartnership(db, partnershipId);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (p.status !== "active") throw new Error("Joint pursuits need an active partnership.");

  // The disclosure gate: only accounts BOTH sides already know they share.
  const eligible = await namedOverlapAccounts(db, partnershipId);
  const account = eligible.find((a) => a.company_id === companyId);
  if (!account) {
    throw new Error(
      "That account isn't in this partnership's approved named overlap — run the blind-overlap ladder to the named rung first.",
    );
  }

  const { rows: existing } = await db.query(
    `select status from joint_pursuits where partnership_id = $1 and company_id = $2`,
    [partnershipId, companyId],
  );
  if (existing[0] && existing[0].status !== "declined") {
    throw new Error(`A joint pursuit on this account already exists (${existing[0].status}).`);
  }
  if (existing[0]) {
    await db.query(`delete from joint_pursuits where partnership_id = $1 and company_id = $2`, [partnershipId, companyId]);
  }

  const names = await orgNames(db, memberOrgs(p));
  const { rows } = await db.query<{ id: string }>(
    `insert into joint_pursuits (partnership_id, company_id, name, proposed_by_org)
     values ($1, $2, $3, $4) returning id`,
    [partnershipId, companyId, `${account.name} — joint pursuit`, orgId],
  );
  const pursuitId = rows[0].id;
  await addEvent(db, pursuitId, orgId, "status", `${names[orgId]} proposed this joint pursuit.`);
  for (const org of memberOrgs(p)) {
    await audit(db, org, "joint.proposed", { account: account.name, by: org === orgId ? "us" : "counterpart" }, p.id);
  }
  return pursuitId;
}

export async function decideJointPursuit(db: Db, orgId: string, pursuitId: string, accept: boolean): Promise<void> {
  const { rows } = await db.query<{
    id: string; partnership_id: string; proposed_by_org: string; status: string; name: string;
  }>(`select id, partnership_id, proposed_by_org, status, name from joint_pursuits where id = $1`, [pursuitId]);
  const pursuit = rows[0];
  if (!pursuit) throw new Error("Pursuit not found.");
  if (pursuit.status !== "proposed") throw new Error(`This pursuit is already ${pursuit.status}.`);

  const p = await loadPartnership(db, pursuit.partnership_id);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (pursuit.proposed_by_org === orgId) throw new Error("The proposing side can't accept its own pursuit.");

  const names = await orgNames(db, memberOrgs(p));
  await db.query(
    `update joint_pursuits set status = $2, decided_at = now() where id = $1`,
    [pursuitId, accept ? "active" : "declined"],
  );
  await addEvent(db, pursuitId, orgId, "status", `${names[orgId]} ${accept ? "accepted — the room is open" : "declined"}.`);
  for (const org of memberOrgs(p)) {
    await audit(db, org, accept ? "joint.accepted" : "joint.declined", { pursuit: pursuit.name }, p.id);
  }
  if (accept) await brokerPropose(db, pursuitId);
}

export async function closeJointPursuit(db: Db, orgId: string, pursuitId: string): Promise<void> {
  const { rows } = await db.query<{ partnership_id: string; status: string; name: string }>(
    `select partnership_id, status, name from joint_pursuits where id = $1`,
    [pursuitId],
  );
  if (!rows[0]) throw new Error("Pursuit not found.");
  const p = await loadPartnership(db, rows[0].partnership_id);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (rows[0].status !== "active") throw new Error("Only an active pursuit can be closed.");
  const names = await orgNames(db, memberOrgs(p));
  await db.query(`update joint_pursuits set status = 'closed', closed_at = now() where id = $1`, [pursuitId]);
  await addEvent(db, pursuitId, orgId, "status", `${names[orgId]} closed this pursuit.`);
  for (const org of memberOrgs(p)) await audit(db, org, "joint.closed", { pursuit: rows[0].name }, p.id);
}

export async function addPursuitNote(db: Db, orgId: string, pursuitId: string, body: string): Promise<void> {
  const { rows } = await db.query<{ partnership_id: string; status: string }>(
    `select partnership_id, status from joint_pursuits where id = $1`,
    [pursuitId],
  );
  if (!rows[0]) throw new Error("Pursuit not found.");
  const p = await loadPartnership(db, rows[0].partnership_id);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (rows[0].status !== "active") throw new Error("Notes can only be added to an active pursuit.");
  const trimmed = body.trim().slice(0, 2000);
  if (!trimmed) throw new Error("Write something first.");
  // Double-submit guard: an identical note from the same org within a minute
  // is a duplicate click (or a hydration-boundary double fire), not intent.
  const { rows: dup } = await db.query(
    `select 1 from joint_pursuit_events
     where pursuit_id = $1 and org_id = $2 and kind = 'note' and body = $3
       and created_at > now() - interval '60 seconds'`,
    [pursuitId, orgId, trimmed],
  );
  if (dup.length > 0) return;
  await addEvent(db, pursuitId, orgId, "note", trimmed);
}

// ── The broker (v1: deterministic, consented data only) ─────────────────────

export async function brokerPropose(db: Db, pursuitId: string): Promise<void> {
  const { rows } = await db.query<{
    id: string; partnership_id: string; company_id: string; name: string; status: string;
  }>(`select id, partnership_id, company_id, name, status from joint_pursuits where id = $1`, [pursuitId]);
  const pursuit = rows[0];
  if (!pursuit) throw new Error("Pursuit not found.");
  if (pursuit.status !== "active") throw new Error("The broker only works open rooms.");

  const p = await loadPartnership(db, pursuit.partnership_id);
  const [orgA, orgB] = memberOrgs(p);
  const names = await orgNames(db, [orgA, orgB]);

  // CONSENTED data only: the approved named-overlap snapshot for this account.
  const eligible = await namedOverlapAccounts(db, pursuit.partnership_id);
  const account = eligible.find((a) => a.company_id === pursuit.company_id);
  if (!account) throw new Error("The named-overlap snapshot no longer covers this account.");

  const aCats = account.cats[orgA] ?? [];
  const bCats = account.cats[orgB] ?? [];
  const aCustomer = aCats.includes("customer");
  const bCustomer = bCats.includes("customer");

  let leadOrgId: string | null = null;
  const rationale: string[] = [
    `${names[orgA]} holds this account as: ${aCats.map((c) => c.replace(/_/g, " ")).join(", ") || "—"}.`,
    `${names[orgB]} holds this account as: ${bCats.map((c) => c.replace(/_/g, " ")).join(", ") || "—"}.`,
  ];
  let play: string;
  if (aCustomer && !bCustomer) {
    leadOrgId = orgA;
    play = `${names[orgA]} has the customer relationship — they open with a warm intro; ${names[orgB]} brings the expansion play.`;
  } else if (bCustomer && !aCustomer) {
    leadOrgId = orgB;
    play = `${names[orgB]} has the customer relationship — they open with a warm intro; ${names[orgA]} brings the expansion play.`;
  } else if (aCustomer && bCustomer) {
    play = `Both sides serve this account — co-serve: align the two account teams before any outreach, and reconcile renewal timelines to avoid competing asks.`;
  } else {
    play = `Neither side has the customer relationship yet — greenfield co-pursuit: agree ONE opener so the account isn't double-touched, and register the deal before outreach.`;
  }

  const nextSteps = [
    leadOrgId ? `${names[leadOrgId]} opens the conversation; the other side joins the first call.` : "Agree which side opens, in this room, before anyone reaches out.",
    "Confirm deal registration so effort is protected on both sides.",
    "Set the joint success criterion for the next 30 days and note it here.",
  ];

  // Joint playbook (task #83): co-authored by both sides, so quoting it keeps
  // the broker's symmetric-information invariant intact.
  const jointPlaybook = await loadJointPlaybook(db, pursuit.partnership_id);
  const playbookLine = jointPlaybook
    ? `Per the joint playbook both sides wrote: "${jointPlaybook.body.slice(0, 280)}${jointPlaybook.body.length > 280 ? "…" : ""}"`
    : null;

  const body = [
    `Broker proposal for ${account.name}:`,
    ...rationale,
    play,
    ...(playbookLine ? [playbookLine] : []),
    "Next steps:",
    ...nextSteps.map((s, i) => `${i + 1}. ${s}`),
    "(Composed only from the partnership's approved named-overlap data — both sides see this identically.)",
  ].join("\n");

  await addEvent(db, pursuitId, null, "proposal", body, { leadOrgId, aCats, bCats });
}

// ── Read models ─────────────────────────────────────────────────────────────

export interface PursuitView {
  id: string;
  partnershipId: string;
  companyId: string;
  name: string;
  status: string;
  proposedByOrg: string;
  otherOrgName: string | null;
  accountName: string;
  industry: string | null;
  createdAt: string;
  awaitingYou: boolean;
}

export async function listJointPursuits(db: Db, orgId: string): Promise<PursuitView[]> {
  const { rows } = await db.query<{
    id: string; partnership_id: string; company_id: string; name: string; status: string;
    proposed_by_org: string; created_at: Date; legal_name: string; industry: string | null;
    other_name: string | null;
  }>(
    `select jp.id, jp.partnership_id, jp.company_id, jp.name, jp.status, jp.proposed_by_org,
            jp.created_at, c.legal_name, c.industry,
            (select o.name from organizations o
             where o.id = case when p.initiator_org_id = $1 then p.counterpart_org_id else p.initiator_org_id end) as other_name
     from joint_pursuits jp
     join partnerships p on p.id = jp.partnership_id
     join companies c on c.id = jp.company_id
     where p.initiator_org_id = $1 or p.counterpart_org_id = $1
     order by jp.created_at desc`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    partnershipId: r.partnership_id,
    companyId: r.company_id,
    name: r.name,
    status: r.status,
    proposedByOrg: r.proposed_by_org,
    otherOrgName: r.other_name,
    accountName: r.legal_name,
    industry: r.industry,
    createdAt: new Date(r.created_at).toISOString().slice(0, 10),
    awaitingYou: r.status === "proposed" && r.proposed_by_org !== orgId,
  }));
}

export interface PursuitEventView {
  id: string;
  kind: string;
  actor: string;
  /** "us" | "them" | "broker" — resolved per viewer; the BODY is symmetric */
  side: "us" | "them" | "broker";
  body: string;
  createdAt: string;
}

export async function pursuitEvents(db: Db, orgId: string, pursuitId: string): Promise<PursuitEventView[]> {
  const { rows } = await db.query<{
    id: string; org_id: string | null; actor: string; kind: string; body: string; created_at: Date;
  }>(
    `select id, org_id, actor, kind, body, created_at from joint_pursuit_events
     where pursuit_id = $1 order by created_at asc`,
    [pursuitId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    actor: r.actor,
    side: r.org_id === null ? "broker" : r.org_id === orgId ? "us" : "them",
    body: r.body,
    createdAt: new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
  }));
}
