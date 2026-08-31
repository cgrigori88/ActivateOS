import type { PoolClient } from "pg";
import { getSellerPaths } from "../partners/intelligence";
import type { ConstraintView } from "@/components/intel/constraint-language";

/**
 * Stakeholder Intelligence read models (P1C). Pure reads over the extended `stakeholders`
 * substrate + the existing relationship substrates — the canonical projection every surface
 * consumes (Pursuit Detail, Brief, Accounts, Today, Motion overlays, ⌘K). The hero question is
 * COVERAGE ("who are we missing?"), never the address book.
 *
 * Truth boundaries:
 *  - coverage roles are the existing deal-risk checklist (opportunities/lifecycle.stakeholderGaps):
 *    economic_buyer, champion, technical_buyer — canonical vocabulary, no new roles;
 *  - a pursuit with no linked opportunity has coverage NOT ESTABLISHED (the locked v1 answer to
 *    the opportunity-dependent PK) — UNKNOWN, never synthesized;
 *  - warm paths are typed, evidence-tiered statements. Account overlap alone NEVER manufactures
 *    a person-level path; the tiers are explicit and UNKNOWN is a valid, common answer.
 */

export const COVERAGE_ROLES = ["economic_buyer", "champion", "technical_buyer"] as const;
export type CoverageState = "VERIFIED" | "INFERRED" | "UNVERIFIED" | "MISSING";

export interface StakeholderPerson { contactId: string; name: string | null; title: string | null; sentiment: string }
export interface RoleCoverage {
  role: string;
  state: CoverageState;
  person: StakeholderPerson | null;             // the best assertion's person (null when MISSING)
  source: string | null; assertedAt: string | null;
  candidates: StakeholderPerson[];              // weaker assertions of the same role
  whyItMatters: string;
  verifyingEvidence: string;                    // what evidence WOULD verify this role
}
export interface WarmPathStatement {
  /** Evidence tier — the statement never claims more than its tier supports. */
  tier: "PERSON_VERIFIED" | "SELLER_ACCOUNT" | "ACCOUNT_OVERLAP" | "UNKNOWN";
  text: string;
  via: string | null;                           // partner label (null = vendor's own seller)
  refType: string; refId: string | null;
}
export interface StakeholderCoverage {
  established: boolean;
  /** Why coverage is not established (structural, honest) — null when established. */
  notEstablishedReason: string | null;
  pursuitId: string; companyId: string | null; expectedValue: number | null;
  /** Linked opportunity ids (assertion target; first is used by the governed form). */
  opportunityIds: string[];
  /** Recent governed assertion history (append-only change_ledger) — supersedes stay visible. */
  history: { at: string; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }[];
  roles: RoleCoverage[];
  /** Non-coverage assertions worth knowing (active blocker, influencers) — drawer material. */
  others: { role: string; state: CoverageState; person: StakeholderPerson }[];
  activeBlocker: StakeholderPerson | null;
  warmPaths: WarmPathStatement[];               // ranked strongest-first; [UNKNOWN] when none
  missingRoles: string[];
  /** Coverage-gap questions for the Brief's WHAT TO ASK. */
  gapQuestions: string[];
}

const STATE_RANK: Record<string, number> = { verified: 3, inferred: 2, unverified: 1 };
const toState = (s: string): CoverageState => (s === "verified" ? "VERIFIED" : s === "inferred" ? "INFERRED" : "UNVERIFIED");
export const ROLE_WORD = (r: string) => r.replace(/_/g, " ");

const WHY: Record<string, string> = {
  economic_buyer: "Owns final economic approval — without verified buying authority the commercial close has no confirmed owner.",
  champion: "Sells internally when you are not in the room — a pursuit without one moves only when you push.",
  technical_buyer: "Gates technical validation — unverified here means late-stage technical surprises.",
};
const VERIFY_WITH: Record<string, string> = {
  economic_buyer: "Customer confirms budget/approval ownership (their statement in a meeting or thread, or a decision-process answer).",
  champion: "Observed advocacy — the person moves the deal internally (forwards, convenes, defends) and confirms their stake.",
  technical_buyer: "Customer names them as the technical sign-off, or they run the evaluation.",
};
const GAP_QUESTION: Record<string, string> = {
  economic_buyer: "Who owns final economic approval for this program?",
  champion: "Who inside the account is carrying this initiative when we are not in the room?",
  technical_buyer: "Who signs off on the technical evaluation?",
};

export async function getStakeholderCoverage(db: PoolClient, orgId: string, pursuitId: string): Promise<StakeholderCoverage | null> {
  const pu = (await db.query<{ org_id: string; account_id: string; ev: string | null }>(
    `select org_id, account_id, expected_value_weighted ev from pursuits where id = $1`, [pursuitId])).rows[0];
  if (!pu || pu.org_id !== orgId) return null;
  const expectedValue = pu.ev == null ? null : Number(pu.ev);

  const opps = (await db.query<{ id: string }>(
    `select id from opportunities where pursuit_id = $1 and org_id = $2`, [pursuitId, orgId])).rows;

  // LOCKED v1: the stakeholder substrate is opportunity-keyed. A pre-opportunity pursuit's
  // coverage is NOT ESTABLISHED — stated, never faked.
  if (opps.length === 0) {
    return {
      established: false,
      notEstablishedReason: "Stakeholder coverage not established yet — no linked opportunity (the stakeholder substrate is opportunity-scoped in v1; pre-opportunity coverage is UNKNOWN by design).",
      pursuitId, companyId: pu.account_id, expectedValue,
      opportunityIds: [], history: [],
      roles: [], others: [], activeBlocker: null,
      warmPaths: await getWarmPaths(db, orgId, pu.account_id),
      missingRoles: [], gapQuestions: [],
    };
  }

  const rows = (await db.query<{ contact_id: string; role: string; sentiment: string; assertion_state: string; source: string | null; asserted_at: Date | null; name: string | null; title: string | null }>(
    `select s.contact_id, s.role, s.sentiment, s.assertion_state, s.source, s.asserted_at, ct.name, ct.title
       from stakeholders s join contacts ct on ct.id = s.contact_id
      where s.opportunity_id = any($1)
      order by s.asserted_at desc nulls last`, [opps.map((o) => o.id)])).rows;

  const person = (r: (typeof rows)[number]): StakeholderPerson => ({ contactId: r.contact_id, name: r.name, title: r.title, sentiment: r.sentiment });

  const roles: RoleCoverage[] = COVERAGE_ROLES.map((role) => {
    const of = rows.filter((r) => r.role === role)
      .sort((a, b) => (STATE_RANK[b.assertion_state] ?? 0) - (STATE_RANK[a.assertion_state] ?? 0));
    const best = of[0] ?? null;
    return {
      role,
      state: best ? toState(best.assertion_state) : "MISSING",
      person: best ? person(best) : null,
      source: best?.source ?? null,
      assertedAt: best?.asserted_at ? best.asserted_at.toISOString() : null,
      candidates: of.slice(1).map(person),
      whyItMatters: WHY[role], verifyingEvidence: VERIFY_WITH[role],
    };
  });

  const others = rows.filter((r) => !COVERAGE_ROLES.includes(r.role as (typeof COVERAGE_ROLES)[number]))
    .map((r) => ({ role: r.role, state: toState(r.assertion_state), person: person(r) }));
  const blocker = rows.find((r) => r.role === "blocker" && r.sentiment !== "positive");
  const missingRoles = roles.filter((r) => r.state === "MISSING").map((r) => r.role);
  const unverifiedRoles = roles.filter((r) => r.state === "MISSING" || r.state === "UNVERIFIED" || r.state === "INFERRED");

  const history = (await db.query<{ recorded_at: Date; reason: string | null; before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null }>(
    `select recorded_at, reason, before_state, after_state from change_ledger
      where pursuit_id = $1 and change_type = 'STAKEHOLDER_ROLE_ASSERTED'
      order by recorded_at desc limit 6`, [pursuitId])).rows;

  return {
    established: true, notEstablishedReason: null,
    pursuitId, companyId: pu.account_id, expectedValue,
    opportunityIds: opps.map((o) => o.id),
    history: history.map((h) => ({ at: h.recorded_at.toISOString(), reason: h.reason, before: h.before_state, after: h.after_state })),
    roles, others, activeBlocker: blocker ? person(blocker) : null,
    warmPaths: await getWarmPaths(db, orgId, pu.account_id),
    missingRoles,
    gapQuestions: unverifiedRoles.map((r) => GAP_QUESTION[r.role]).filter(Boolean),
  };
}

/**
 * Warm-path derivation (§6) — typed, evidence-tiered, never manufactured:
 *  PERSON_VERIFIED  an accepted warm intro on this account revealed a named contact — the partner
 *                   demonstrably reached a person here (the strongest existing person-level truth);
 *  SELLER_ACCOUNT   a named seller with an asserted account relationship (tier + recency, UNKNOWN
 *                   recency preserved) — an account-level path, stated as such;
 *  ACCOUNT_OVERLAP  a partner relationship/overlap exists but NO seller-level relationship is
 *                   verified — overlap alone, and the statement says so;
 *  UNKNOWN          nothing evidence-backed — a valid, honest answer.
 *
 * Account ownership, a selected partner, a job title and contact-list presence are NEVER paths.
 */
export async function getWarmPaths(db: PoolClient, orgId: string, companyId: string): Promise<WarmPathStatement[]> {
  const out: WarmPathStatement[] = [];

  // Person-level: accepted intro reveals on this account (partnership consent already given).
  const reveals = (await db.query<{ id: string; revealed: { name?: string; title?: string } | null; partner_name: string | null }>(
    `select wr.id, wr.revealed_contact revealed, p.name partner_name
       from warm_intro_requests wr
       join partnerships pr on pr.id = wr.partnership_id
       left join partners p on p.org_id = $1 and p.id in (pr.initiator_partner_id, pr.counterpart_partner_id)
      where wr.company_id = $2 and wr.requested_by_org = $1 and wr.status = 'accepted' and wr.revealed_contact is not null
      order by wr.decided_at desc limit 3`, [orgId, companyId])).rows;
  for (const r of reveals) {
    out.push({
      tier: "PERSON_VERIFIED", via: r.partner_name,
      text: `${r.partner_name ?? "A partner"} introduced ${r.revealed?.name ?? "a named contact"}${r.revealed?.title ? ` (${r.revealed.title})` : ""} here — an accepted warm intro (person-level, verified by the introduction itself).`,
      refType: "warm_intro_requests", refId: r.id,
    });
  }

  // Seller-level: named sellers with asserted account relationships (decayed; UNKNOWN stays UNKNOWN).
  const sellers = await getSellerPaths(db, orgId, companyId);
  for (const s of sellers.slice(0, 3)) {
    out.push({
      tier: "SELLER_ACCOUNT", via: s.partnerLabel,
      text: `${s.partnerLabel ? `${s.partnerLabel} seller ` : ""}${s.name} holds ${/^[aeiou]/i.test(s.tier) ? "an" : "a"} ${s.tier.replace(/_/g, " ").toLowerCase()} at this account (${s.recency === "UNKNOWN" ? "recency UNKNOWN" : `${s.recency} contact`}) — an account-level relationship, not a claim about a specific person.`,
      refType: "seller_account_relationships", refId: s.sellerId,
    });
  }

  // Overlap-only partners: presence without a named seller relationship — stated as exactly that.
  const namedSellerPartners = new Set(sellers.map((s) => s.partnerLabel).filter(Boolean));
  const overlap = (await db.query<{ id: string; name: string }>(
    `select p.id, p.name from partner_relationships pr join partners p on p.id = pr.partner_id
      where pr.company_id = $1 and p.org_id = $2 and pr.strength > 0
      order by pr.strength desc limit 3`, [companyId, orgId])).rows;
  for (const o of overlap) {
    if (namedSellerPartners.has(o.name)) continue;
    out.push({
      tier: "ACCOUNT_OVERLAP", via: o.name,
      text: `${o.name} has account overlap here, but no seller-level relationship is currently verified — overlap alone is not a warm path.`,
      refType: "partner_relationships", refId: o.id,
    });
  }

  if (out.length === 0) {
    out.push({ tier: "UNKNOWN", via: null, text: "No warm path is known — no accepted intro, no asserted seller relationship, no partner overlap. UNKNOWN, not zero.", refType: "none", refId: null });
  }
  return out;
}

/** The strongest path statement (or the honest UNKNOWN) — the one-liner surfaces render. */
export function bestWarmPath(paths: WarmPathStatement[]): WarmPathStatement {
  return paths.find((p) => p.tier === "PERSON_VERIFIED") ?? paths.find((p) => p.tier === "SELLER_ACCOUNT")
    ?? paths.find((p) => p.tier === "ACCOUNT_OVERLAP") ?? paths[0]
    ?? { tier: "UNKNOWN", via: null, text: "Best known path: UNKNOWN.", refType: "none", refId: null };
}

/**
 * Stakeholder coverage as a canonical constraint (§7) — the SHARED constraint language, computed
 * at render time (no stored blocker record, no score). Non-gating everywhere: the Motion funnel's
 * STAKEHOLDER_GAP overlay stays informational (locked P1A semantics); Today/Pursuit render it as
 * attention. Returns null when there is nothing to say (verified, or coverage not established).
 */
export function stakeholderConstraint(c: StakeholderCoverage): (ConstraintView & { bestPath: WarmPathStatement }) | null {
  if (!c.established) return null;
  const eb = c.roles.find((r) => r.role === "economic_buyer");
  if (!eb || eb.state === "VERIFIED") return null;
  const best = bestWarmPath(c.warmPaths);
  return {
    blockedBy: eb.state === "MISSING" ? "Economic buyer not identified" : `Economic buyer not verified (${eb.state.toLowerCase()})`,
    why: "No verified buying authority on this pursuit.",
    exposureUsd: c.expectedValue,
    severity: "SOFT",
    action: { label: "Verify economic buyer", deepLink: `/pursuits/${c.pursuitId}#stakeholders` },
    bestPath: best,
  };
}
