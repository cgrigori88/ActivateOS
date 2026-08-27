import type { Pool, PoolClient } from "pg";

/**
 * Evidence exchange (slice G): consented sharing of verified claims across an
 * active partnership. The structural answer to single-tenant context fusion —
 * they fuse one company's data; the network fuses the DEAL's data. A claim is
 * only offerable when it is verified AND about an account on the approved
 * named-overlap rung (you can't leak an account the partner doesn't already
 * know you share). The claim stays owned by the offering org; the recipient
 * reads it live with provenance intact; revoking removes it instantly.
 */

type Db = Pool | PoolClient;

export interface EvidenceShareView {
  id: string;
  direction: "outgoing" | "incoming";
  status: string;
  claim: string;
  sourceType: string;
  observedAt: string;
  accountName: string;
  companyId: string;
  offeredAt: string;
}

async function namedOverlapCompanyIds(db: Db, partnershipId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ results: { accounts?: { company_id: string }[] } }>(
    `select results from overlap_probes
     where partnership_id = $1 and level = 'named' and status = 'approved'
     order by computed_at desc limit 1`,
    [partnershipId],
  );
  return new Set((rows[0]?.results?.accounts ?? []).map((a) => a.company_id));
}

/** Verified claims of ours on named-overlap accounts, not yet offered. */
export async function offerableEvidence(
  db: Db,
  orgId: string,
  partnershipId: string,
): Promise<{ id: string; claim: string; accountName: string }[]> {
  const named = await namedOverlapCompanyIds(db, partnershipId);
  if (named.size === 0) return [];
  const { rows } = await db.query<{ id: string; claim: string; legal_name: string }>(
    `select e.id, e.claim, c.legal_name
     from evidence e join companies c on c.id = e.company_id
     where e.company_id = any($1) and e.status = 'verified'
       and (e.org_id = $2 or e.org_id is null)
       and not exists (select 1 from evidence_shares s
                       where s.evidence_id = e.id and s.partnership_id = $3
                         and s.status in ('offered', 'accepted'))
     order by e.observed_at desc limit 30`,
    [[...named], orgId, partnershipId],
  );
  return rows.map((r) => ({ id: r.id, claim: r.claim, accountName: r.legal_name }));
}

export async function offerEvidenceShare(db: Db, orgId: string, partnershipId: string, evidenceId: string): Promise<void> {
  const named = await namedOverlapCompanyIds(db, partnershipId);
  const { rows } = await db.query<{ company_id: string }>(
    `select company_id from evidence where id = $1 and status = 'verified' and (org_id = $2 or org_id is null)`,
    [evidenceId, orgId],
  );
  if (!rows[0]) throw new Error("Only your own verified claims can be offered.");
  if (!named.has(rows[0].company_id)) throw new Error("Evidence can only be shared about accounts on the approved named overlap.");
  await db.query(
    `insert into evidence_shares (evidence_id, partnership_id, offered_by_org)
     values ($1, $2, $3)
     on conflict (evidence_id, partnership_id) do update set status = 'offered', decided_at = null, offered_by_org = $3`,
    [evidenceId, partnershipId, orgId],
  );
  await auditBoth(db, partnershipId, "evidence.offered", { evidence_id: evidenceId });
}

export async function decideEvidenceShare(db: Db, orgId: string, shareId: string, accept: boolean): Promise<void> {
  const { rows } = await db.query<{ id: string; offered_by_org: string; partnership_id: string }>(
    `select s.id, s.offered_by_org, s.partnership_id from evidence_shares s
     join partnerships p on p.id = s.partnership_id
     where s.id = $1 and s.status = 'offered' and s.offered_by_org <> $2
       and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)`,
    [shareId, orgId],
  );
  if (!rows[0]) throw new Error("Not an offer awaiting you.");
  await db.query(`update evidence_shares set status = $2, decided_at = now() where id = $1`, [
    shareId,
    accept ? "accepted" : "declined",
  ]);
  await auditBoth(db, rows[0].partnership_id, accept ? "evidence.accepted" : "evidence.declined", { share_id: shareId });
}

export async function revokeEvidenceShare(db: Db, orgId: string, shareId: string): Promise<void> {
  const { rows } = await db.query(
    `update evidence_shares set status = 'revoked', decided_at = now()
     where id = $1 and offered_by_org = $2 and status in ('offered', 'accepted')
     returning partnership_id`,
    [shareId, orgId],
  );
  if (rows[0]) await auditBoth(db, rows[0].partnership_id, "evidence.revoked", { share_id: shareId });
}

/** Both directions on one partnership, for the partner-room card. */
export async function listEvidenceShares(db: Db, orgId: string, partnershipId: string): Promise<EvidenceShareView[]> {
  const { rows } = await db.query<{
    id: string; status: string; offered_by_org: string; claim: string; source_type: string;
    observed_at: Date; legal_name: string; company_id: string; offered_at: Date;
  }>(
    `select s.id, s.status, s.offered_by_org, e.claim, e.source_type, e.observed_at,
            c.legal_name, e.company_id, s.offered_at
     from evidence_shares s
     join evidence e on e.id = s.evidence_id
     join companies c on c.id = e.company_id
     where s.partnership_id = $1 and s.status <> 'revoked'
     order by s.offered_at desc limit 40`,
    [partnershipId],
  );
  return rows.map((r) => ({
    id: r.id,
    direction: r.offered_by_org === orgId ? "outgoing" : "incoming",
    status: r.status,
    claim: r.claim,
    sourceType: r.source_type,
    observedAt: r.observed_at.toISOString().slice(0, 10),
    accountName: r.legal_name,
    companyId: r.company_id,
    offeredAt: r.offered_at.toISOString().slice(0, 10),
  }));
}

/**
 * Accepted claims shared IN to this org about one account — read live from
 * the partner's record, labeled with the sharing org. Feeds the timeline.
 */
export async function sharedInEvidence(
  db: Db,
  orgId: string,
  companyId: string,
): Promise<{ claim: string; sourceType: string; observedAt: string; sharedBy: string }[]> {
  const { rows } = await db.query<{ claim: string; source_type: string; observed_at: Date; org_name: string }>(
    `select e.claim, e.source_type, e.observed_at, o.name as org_name
     from evidence_shares s
     join partnerships p on p.id = s.partnership_id and p.status = 'active'
       and (p.initiator_org_id = $1 or p.counterpart_org_id = $1)
     join evidence e on e.id = s.evidence_id and e.company_id = $2
     join organizations o on o.id = s.offered_by_org
     where s.status = 'accepted' and s.offered_by_org <> $1
     order by e.observed_at desc limit 20`,
    [orgId, companyId],
  );
  return rows.map((r) => ({
    claim: r.claim,
    sourceType: r.source_type,
    observedAt: r.observed_at.toISOString().slice(0, 10),
    sharedBy: r.org_name,
  }));
}

async function auditBoth(db: Db, partnershipId: string, event: string, detail: Record<string, unknown>): Promise<void> {
  const { rows } = await db.query<{ initiator_org_id: string; counterpart_org_id: string | null }>(
    `select initiator_org_id, counterpart_org_id from partnerships where id = $1`,
    [partnershipId],
  );
  if (!rows[0]) return;
  for (const org of [rows[0].initiator_org_id, rows[0].counterpart_org_id]) {
    if (!org) continue;
    await db.query(
      `insert into audit_log (org_id, actor, event, detail, partnership_id) values ($1, 'operator', $2, $3, $4)`,
      [org, event, JSON.stringify(detail), partnershipId],
    );
  }
}
