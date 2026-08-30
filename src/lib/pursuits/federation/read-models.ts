import type { PoolClient } from "pg";
import { applyDisclosure, resolveDisclosure, type Disclosable, type FederationViewer } from "./disclosure";
import { buildFederationViewer } from "./grants";
import { SKILL_REGISTRY, type Actor } from "./skills";

/**
 * Participant-facing read models (Workstream E3-H). Every federated read goes through
 * one door: the DB scopes rows by `can_see_pursuit` RLS, and this layer applies
 * caller-specific DISCLOSURE (R3/R7) so a participant sees only what its standing
 * permits — the exact value for shared context, a generalized/aggregate substitute
 * where policy downgrades, and nothing at all where it is suppressed (existence
 * hidden). These are projections: they never recompute a score or decide anything.
 */

export interface ParticipantView { orgId: string; orgName: string | null; roleKey: string; state: string; isSponsor: boolean }
export interface FederationView {
  viewerOrgId: string;
  isSponsor: boolean;
  isParticipant: boolean;
  participants: ParticipantView[];
  /** Disclosure-filtered shared context the viewer is permitted to see. */
  sharedContext: { visibility: string; value: { label: string; detail: string } }[];
}

/** Participants + per-viewer shared context on a Pursuit (disclosure-first). */
export async function getPursuitFederation(db: PoolClient, viewerOrgId: string, pursuitId: string): Promise<FederationView | null> {
  const viewer = await buildFederationViewer(db, viewerOrgId, pursuitId);
  if (!viewer.isSponsor && !viewer.isParticipant) return null; // no standing → nothing (T11)

  const sponsorRow = await db.query<{ org_id: string }>(`select org_id from pursuits where id = $1`, [pursuitId]);
  const sponsorOrg = sponsorRow.rows[0]?.org_id ?? null;

  const { rows } = await db.query<{ org_id: string; org_name: string | null; role_key: string; participation_state: string }>(
    `select p.org_id, o.name as org_name, p.role_key, p.participation_state
       from pursuit_participants p left join organizations o on o.id = p.org_id
      where p.pursuit_id = $1 order by p.created_at`, [pursuitId]);
  const participants: ParticipantView[] = rows.map((r) => ({
    orgId: r.org_id, orgName: r.org_name, roleKey: r.role_key, state: r.participation_state, isSponsor: r.org_id === sponsorOrg,
  }));

  // Shared-context items are disclosure-classified; applyDisclosure omits suppressed ones.
  const ctxRows = await db.query<{ source_org_id: string; disclosure_class: string | null; sensitivity_class: string | null; semantic_meaning: string | null; contribution_mode: string }>(
    `select source_org_id, disclosure_class, sensitivity_class, semantic_meaning, contribution_mode
       from context_contributions where pursuit_id = $1 and revocation_state = 'ACTIVE'`, [pursuitId]);
  const items: Disclosable<{ label: string; detail: string }>[] = ctxRows.rows.map((c) => ({
    ownerOrgId: c.source_org_id,
    audience: (c.disclosure_class as Disclosable<unknown>["audience"]) ?? "PURSUIT_INTERNAL",
    sensitivity: (c.sensitivity_class as Disclosable<unknown>["sensitivity"]) ?? undefined,
    value: { label: c.contribution_mode, detail: c.semantic_meaning ?? "" },
    generalized: { label: c.contribution_mode, detail: "Shared signal (generalized)" },
  }));
  const sharedContext = applyDisclosure(items, viewer);

  return { viewerOrgId, isSponsor: viewer.isSponsor, isParticipant: viewer.isParticipant, participants, sharedContext };
}

export interface GovernedActionView {
  eligible: { skillId: string; description: string; effectClass: string; requiredPermission: string }[];
  history: { skillId: string; status: string; effectClass: string; occurredAt: string; reason: string | null }[];
}

/** Skills THIS actor may invoke here (by eligibility + permission) + the invocation history. */
export async function getGovernedActions(db: PoolClient, actor: Actor, pursuitId: string): Promise<GovernedActionView> {
  const ROLE_RANK: Record<string, number> = { any: 0, viewer: 1, operator: 2, owner: 3 };
  const eligible = SKILL_REGISTRY
    .filter((s) => s.eligibleActors.includes(actor.type) && ROLE_RANK[actor.role ?? "any"] >= ROLE_RANK[s.requiredPermission])
    .map((s) => ({ skillId: s.skillId, description: s.description, effectClass: s.effectClass, requiredPermission: String(s.requiredPermission) }));
  const { rows } = await db.query<{ skill_id: string; status: string; effect_class: string; requested_at: Date; reason: string | null }>(
    `select skill_id, status, effect_class, requested_at, reason from governed_action_invocations
      where pursuit_id = $1 order by requested_at desc limit 50`, [pursuitId]);
  return {
    eligible,
    history: rows.map((r) => ({ skillId: r.skill_id, status: r.status, effectClass: r.effect_class, occurredAt: r.requested_at.toISOString(), reason: r.reason })),
  };
}

export interface OutcomeTrailView {
  outcomes: { label: string; isTerminal: boolean; occurredAt: string; valueAmount: number | null }[];
  attribution: { subject: string; class: string; effectiveClass: string; modelVersion: string }[];
}

/**
 * The outcome trail + attribution for a Pursuit, disclosure-filtered. Outcome LABELS
 * are participant-shared (the fact something happened), while value magnitudes downgrade
 * for non-sponsors — the factual outcome and the attribution claim stay separate (R15).
 */
export async function getPursuitOutcomes(db: PoolClient, viewer: FederationViewer, pursuitId: string): Promise<OutcomeTrailView | null> {
  if (!viewer.isSponsor && !viewer.isParticipant) return null;
  const o = await db.query<{ outcome_label: string; is_terminal: boolean; occurred_at: Date; value_amount: string | null }>(
    `select outcome_label, is_terminal, occurred_at, value_amount from pursuit_outcomes where pursuit_id = $1 order by occurred_at asc`, [pursuitId]);

  // Value magnitude is sponsor-only; the label itself is participant-shared. Resolve
  // per-item (order preserved) so a suppressed value maps to null, not a shifted index.
  const outcomes = o.rows.map((r) => {
    const res = resolveDisclosure<number | null>({
      ownerOrgId: viewer.isSponsor ? viewer.orgId : "__sponsor__",
      audience: "PURSUIT_INTERNAL",
      value: r.value_amount === null ? null : Number(r.value_amount),
      generalized: null,
    }, viewer);
    return {
      label: r.outcome_label, isTerminal: r.is_terminal, occurredAt: r.occurred_at.toISOString(),
      valueAmount: res.visibility === "EXACT" ? res.value : null,
    };
  });

  const a = await db.query<{ subject_label: string | null; subject_kind: string; attribution_class: string; human_override_class: string | null; model_version: string }>(
    `select subject_label, subject_kind, attribution_class, human_override_class, model_version from attribution where pursuit_id = $1 order by computed_at desc`, [pursuitId]);
  const attribution = a.rows.map((r) => ({
    subject: r.subject_label ?? r.subject_kind, class: r.attribution_class,
    effectiveClass: r.human_override_class ?? r.attribution_class, modelVersion: r.model_version,
  }));
  return { outcomes, attribution };
}

export type { FederationViewer };
