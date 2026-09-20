import type { PoolClient } from "pg";
import { hasActionAuthority } from "./grants";
import { acceptParticipation } from "./participation";
import { draftTouchImpl, requestWarmIntroImpl, warmIntroAuthorize } from "../../agents/mcp-writes";
import { selectRouteByCandidate } from "../../routing/override";
import type { OverrideCategory } from "../../routing/types";
import { assembleTeam, transitionMember } from "../../routing/team";
import { approveMotion, rejectMotion, type EditableField } from "../../motions/approve";
import { recordChange } from "../ledger";
import type { DataEnvironment } from "../lineage";
import { reportEvent } from "../../obs/reporter";
import { governedAgentEnforcementEnabled } from "@/lib/env/environment";
import { liveGrantFor, type LiveGrant } from "@/lib/runtime/grant-liveness";
import { randomUUID } from "node:crypto";
import { P8_OBSERVATION_CONTRACT_V1, coveredByV1, discardEffects, drainEffects, effectSinkOf, noteEffectOnCtx, observedInvocationId, persistEffects, withObservation } from "./observation";

/**
 * Governed Skill boundary (Workstream E3-D, R9/R24/R25/R26). `dispatchSkill` is
 * the single legality gate for governed commercial mutation: it resolves the
 * versioned registry, checks eligible actor + required permission, validates the
 * effect class (READ may not mutate; CROSS_TENANT_ACTION requires an ACTION grant,
 * never a DATA grant, R24; EXTERNAL_ACTION is queued to the outbox, never run
 * inline, R25), enforces idempotency, runs a loop guard (R23), executes the bound
 * domain handler, and records the invocation. UI asks; this boundary decides.
 */

export type EffectClass = "READ" | "INTERNAL_WRITE" | "EXTERNAL_ACTION" | "CROSS_TENANT_ACTION";
export type ActorType = "USER" | "AGENT" | "WORKER" | "SYSTEM";
export type Role = "owner" | "operator" | "viewer" | null;
const ROLE_RANK: Record<string, number> = { any: 0, viewer: 1, operator: 2, owner: 3 };

export interface Actor { type: ActorType; id?: string | null; orgId: string; role: Role }
export interface DispatchCtx {
  pursuitId?: string | null;
  target?: { kind?: string; id?: string } ;
  args?: Record<string, unknown>;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  dataEnvironment?: string;
  /**
   * P45-1. The registered governed actor (P4) on whose authority this dispatch is made, and the
   * runtime step that requested it. BOTH ARE OPTIONAL AND ADDITIVE: every pre-existing caller omits
   * them and is evaluated exactly as before. When `governedActorId` IS supplied, the actor must
   * exist in this org, be ACTIVE, match the acting principal, and hold a live capability grant for
   * the skill — checks that run IN ADDITION TO, never instead of, eligibility, permission, the loop
   * guard, preconditions, cross-tenant authority and the send gates. A grant permits consideration;
   * it does not override policy.
   */
  governedActorId?: string | null;
  runStepId?: string | null;
}
export interface DispatchResult { status: string; invocationId: string | null; reason?: string; result?: unknown; queued?: boolean }

/** The capability that authorises deciding a pending governed action (P45-2). */
export const DECIDE_SKILL = "decide_governed_action";

/**
 * Does this action require a human decision before it may execute?
 *
 *   override TRUE  → REQUIRED — a grant may always NARROW policy by demanding approval.
 *   override NULL  → the canonical skill policy.
 *   override FALSE → only ever "not required" when the SKILL itself does not require it. A grant can
 *                    never relax a canonical requirement: in Slice 2 every `approval_required = true`
 *                    is HARD. A future soft-approval policy would need its own schema/policy change,
 *                    and that abstraction is deliberately not invented here.
 *
 * The decision capability itself can never require approval — the base case that stops the
 * governance model recursing.
 */
export function effectiveApprovalRequired(
  skillId: string, skillApprovalRequired: boolean, override: boolean | null | undefined,
): boolean {
  if (skillId === DECIDE_SKILL) return false;
  if (override === true) return true;
  if (override === false) return skillApprovalRequired === true;   // FALSE cannot weaken a hard rule
  return skillApprovalRequired === true;
}

interface SkillDef {
  skillId: string; version: number; description: string;
  effectClass: EffectClass; eligibleActors: ActorType[]; requiredPermission: keyof typeof ROLE_RANK;
  actionFamily?: string; provider?: string;
  precheck?: (db: PoolClient, actor: Actor, ctx: DispatchCtx) => Promise<{ ok: boolean; reason?: string }>;
  /**
   * Cross-tenant authority hook (R1-G1). When a CROSS_TENANT_ACTION skill supplies
   * this, it REPLACES the default federation context-grant check (`hasActionAuthority`)
   * — so an action whose consent lives in a different fabric (e.g. a warm intro gated
   * by an active partnership) is still governed here, not through an unrelated model.
   */
  authorize?: (db: PoolClient, actor: Actor, ctx: DispatchCtx) => Promise<{ ok: boolean; reason?: string }>;
  handler?: (db: PoolClient, actor: Actor, ctx: DispatchCtx) => Promise<unknown>;
}

/** The seed registry. Handlers live here (functions can't live in the DB); metadata is mirrored to governed_skills. */
export const SKILL_REGISTRY: SkillDef[] = [
  { skillId: "explain_route", version: 1, description: "Explain the recommended route", effectClass: "READ",
    eligibleActors: ["USER", "AGENT", "WORKER", "SYSTEM"], requiredPermission: "viewer",
    handler: async () => ({ explained: true }) },
  // Canonical route decision (the first human governed commercial mutation with a live audit
  // trail). Both wrap the single route mutation `selectRouteByCandidate`; selection vs override is
  // computed there from recommended-vs-chosen, so the skill id is the operator's intent and the
  // ledger records the reality (PARTNER_SELECTED / PARTNER_OVERRIDE). Recommendation is preserved.
  { skillId: "select_partner_route", version: 1, description: "Approve (select) a recommended partner route", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: pursuitInOrg,
    handler: async (db, actor, ctx) => selectRouteByCandidate(db, actor.orgId, String(ctx.pursuitId), String(ctx.args?.candidateKey), {
      actorId: actor.id ?? null, env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION", correlationId: ctx.correlationId ?? null }) },
  { skillId: "override_partner_route", version: 1, description: "Override the recommended partner route (human decision)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: pursuitInOrg,
    handler: async (db, actor, ctx) => selectRouteByCandidate(db, actor.orgId, String(ctx.pursuitId), String(ctx.args?.candidateKey), {
      actorId: actor.id ?? null, reason: ctx.args?.reason ? String(ctx.args.reason) : undefined,
      category: (ctx.args?.category as OverrideCategory) ?? "OTHER", env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION",
      correlationId: ctx.correlationId ?? null }) },
  { skillId: "explain_partner_route", version: 1, description: "Explain the route candidate comparison (read-only)", effectClass: "READ",
    eligibleActors: ["USER", "AGENT", "WORKER", "SYSTEM"], requiredPermission: "viewer",
    handler: async () => ({ explained: true }) },
  { skillId: "accept_participation", version: 1, description: "Accept a Pursuit participation invitation", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator",
    // Org-scoped in the handler (acceptParticipation refuses a row the actor's org is not party to):
    // the pursuit here is the SPONSOR's, so pursuitInOrg would wrongly reject the invited org.
    handler: async (db, actor, ctx) => { await acceptParticipation(db, actor.orgId, String(ctx.args?.participantId)); return { accepted: true }; } },
  // Pursuit Team — governed confirmation lifecycle (Phase C1). A recommended team is a
  // proposal; only these governed decisions move a member off RECOMMENDED. Recompute may
  // change the recommendation (assembleTeam is idempotent and skips confirmed roles), but it
  // may never silently remove a confirmed human assignment. All reuse `transitionMember`
  // (the one team-status mutation), which records the append-only TEAM_MEMBER_* event.
  { skillId: "assemble_pursuit_team", version: 1, description: "Assemble the recommended pursuit team from the selected route", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER", "SYSTEM"], requiredPermission: "operator", precheck: pursuitInOrg,
    handler: async (db, _a, ctx) => {
      const r = await assembleTeam(db, String(ctx.pursuitId), (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION",
        observedInvocationId(ctx));
      // Exactly one ref per row THIS dispatch inserted. Every role already filled ⇒ N = 0, which is
      // the canonical supported-and-empty case: marked invocation, zero effects, and that is a fact.
      for (const id of r.createdIds) noteEffectOnCtx(ctx, "pursuit_team_member", id);
      return r;
    } },
  { skillId: "confirm_team_member", version: 1, description: "Confirm (invite) a recommended team member — the human team decision", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: teamMemberInOrg,
    handler: async (db, _a, ctx) => { await transitionMember(db, String(ctx.args?.memberId), "INVITED", (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION"); return { confirmed: true, memberId: ctx.args?.memberId }; } },
  { skillId: "accept_team_member", version: 1, description: "Record a confirmed team member's acceptance (feeds readiness)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: teamMemberInOrg,
    handler: async (db, _a, ctx) => { await transitionMember(db, String(ctx.args?.memberId), "ACCEPTED", (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION"); return { accepted: true, memberId: ctx.args?.memberId }; } },
  { skillId: "decline_team_member", version: 1, description: "Record that an invited team member declined the role", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: teamMemberInOrg,
    handler: async (db, _a, ctx) => { await transitionMember(db, String(ctx.args?.memberId), "DECLINED", (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION"); return { declined: true, memberId: ctx.args?.memberId }; } },
  { skillId: "request_team_acceptance", version: 1, description: "Ask a partner org to accept a confirmed pursuit-team role (cross-tenant)", effectClass: "CROSS_TENANT_ACTION",
    eligibleActors: ["USER"], requiredPermission: "operator", actionFamily: "team.request_acceptance",
    handler: async (db, actor, ctx) => {
      // Real cross-tenant ask (no longer a stub): the role must already be a confirmed (INVITED)
      // assignment in this org before we ask the partner to accept it. We record the request as a
      // material event on the pursuit; the partner's acceptance is a separate governed decision.
      const m = (await db.query<{ status: string; role: string; pursuit_id: string }>(
        `select status, role, pursuit_id from pursuit_team_members where id = $1 and org_id = $2`,
        [String(ctx.args?.memberId), actor.orgId])).rows[0];
      if (!m) throw new Error(`team member ${ctx.args?.memberId} not found in this org`);
      if (m.status !== "INVITED") throw new Error(`team member must be confirmed (INVITED) before requesting acceptance — is ${m.status}`);
      await recordChange(db, { orgId: actor.orgId, pursuitId: m.pursuit_id, entityType: "pursuit", entityId: m.pursuit_id,
        changeType: "TEAM_CHANGED", materiality: "MEDIUM", reason: `Acceptance requested for ${m.role}`, actorType: "USER", actorId: actor.id ?? null,
        triggerType: "GOVERNED_ACTION", dataEnvironment: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION" });
      return { requested: true, memberId: ctx.args?.memberId, role: m.role };
    } },
  // Motion approval — the human gate as a governed mutation (Phase C4). Approval/rejection run
  // through the SAME dispatch authority as route selection; no direct CRUD bypass. The handlers
  // wrap the canonical `approveMotion`/`rejectMotion` (which capture the human edit diff for the
  // learning loop). Motion completion → commercial outcome is Phase B's bridge, not this path.
  { skillId: "approve_motion", version: 1, description: "Approve a draft revenue motion (human gate, with edits)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: motionInOrg,
    handler: async (db, actor, ctx) => approveMotion(db, actor.orgId, String(ctx.args?.motionId), (ctx.args?.edits as Partial<Record<EditableField, string>>) ?? {}) },
  { skillId: "reject_motion", version: 1, description: "Reject a draft revenue motion (human gate)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: motionInOrg,
    handler: async (db, actor, ctx) => { await rejectMotion(db, actor.orgId, String(ctx.args?.motionId), ctx.args?.note ? String(ctx.args.note) : undefined); return { rejected: true }; } },
  { skillId: "send_partner_intro", version: 1, description: "Send a warm introduction to a partner (external)", effectClass: "EXTERNAL_ACTION",
    eligibleActors: ["USER"], requiredPermission: "operator", actionFamily: "intro.email", provider: "email" },
  // R1-G4 — an APPROVED outreach send is a governed EXTERNAL_ACTION: enqueued to the
  // transactional outbox and performed by the executor, never inline. Drafting ≠ sending;
  // approval ≠ execution. The scheduler/worker (WORKER) or an operator may enqueue it.
  { skillId: "send_campaign_touch", version: 1, description: "Execute an approved outreach send (external)", effectClass: "EXTERNAL_ACTION",
    eligibleActors: ["USER", "WORKER", "SYSTEM"], requiredPermission: "operator", actionFamily: "outreach.send", provider: "email" },
  // R1-G1 — the governed home of the MCP write surface. draft_campaign_touch is an
  // internal draft (agents allowed; behind the human approval gate). request_warm_intro
  // is cross-tenant; its authority is the active partnership, checked via `authorize`.
  { skillId: "draft_campaign_touch", version: 1, description: "Draft a campaign email touch (draft-only, behind human approval)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER", "AGENT"], requiredPermission: "operator",
    handler: async (db, actor, ctx) => {
      const r = await draftTouchImpl(db, actor.orgId, ctx.args ?? {});
      // The id of the row the CREATION branch just returned — not a later lookup, and not parsed
      // from a persisted payload. When no campaign matched, nothing durable was created and no
      // effect is recorded: zero refs on a marked invocation means observed zero.
      const touchId = (r as { touchId?: unknown } | null)?.touchId;
      if (typeof touchId === "string") noteEffectOnCtx(ctx, "campaign_touch", touchId);
      return r;
    } },
  { skillId: "request_warm_intro", version: 1, description: "Request a warm introduction into a named-overlap account (cross-tenant)", effectClass: "CROSS_TENANT_ACTION",
    eligibleActors: ["USER", "AGENT"], requiredPermission: "operator", actionFamily: "intro.request",
    authorize: async (db, actor, ctx) => warmIntroAuthorize(db, actor.orgId, ctx.args ?? {}),
    handler: async (db, actor, ctx) => requestWarmIntroImpl(db, actor.orgId, ctx.args ?? {}) },
  // Stakeholder Intelligence (P1C) — the single authority for buying-role assertions. Agents may
  // propose (inferred/unverified); only a human verifies; title alone can never establish a role;
  // every assertion appends its history. The handler holds the transaction-local flag the 0097
  // DB trigger requires, so no other code path can mutate role/assertion_state.
  { skillId: "assert_stakeholder_role", version: 1, description: "Assert a stakeholder's buying role with state (verified/inferred/unverified) and evidence", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER", "AGENT"], requiredPermission: "operator",
    precheck: async (db, actor, ctx) => (await import("../../stakeholders/assert")).stakeholderInOrg(db, actor.orgId, ctx.args),
    handler: async (db, actor, ctx) => (await import("../../stakeholders/assert")).assertStakeholderRole(
      db, actor, ctx.args ?? {}, (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION") },
  // Canonical economic assertion (P2B §7): the ONLY authoritative path for an economic driver.
  // Migration 0099's trigger rejects a trusted-provenance economic fact written outside it.
  { skillId: "assert_economic_fact", version: 1, description: "Assert an economic driver (point or range) with provenance, source and evidence", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER", "AGENT"], requiredPermission: "operator",
    precheck: async (db, actor, ctx) => (await import("../../value/assert")).economicSubjectInOrg(db, actor.orgId, ctx.args),
    handler: async (db, actor, ctx) => (await import("../../value/assert")).assertEconomicFact(
      db, actor, ctx.args ?? {}, (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION") },
];

/**
 * vNext Slice 2A — Pursuit Coordination skills. Dispatchable exactly like the registry above
 * (`defFor` resolves both), but kept OUT of `SKILL_REGISTRY` on purpose: the Federation panel
 * lists every registry skill as "actions you can take", and `seedGovernedSkills` mirrors the
 * registry into `governed_skills`. Adding these there would change the flag-OFF Pursuit page and
 * the mirrored registry for a capability that is switched off. They are decided on the Pursuit
 * plan surface, not the Federation panel. They join the registry when the capability graduates.
 */
export const COORDINATION_SKILLS: SkillDef[] = [
  // P45-2. The capability that authorises DECIDING a pending governed action — both outcomes, with
  // APPROVED | REJECTED carried as the decision, which is why it is not named "approve_*".
  //
  // IT LIVES HERE, NOT IN SKILL_REGISTRY, for the reason this array exists: the Federation panel
  // lists every registry skill as "actions you can take", so registering it there added a line to
  // the flag-OFF Pursuit page — a user-visible pilot change from a capability that is switched off.
  // `defFor` resolves both arrays, so dispatch is unaffected; only the listing is. Caught by the
  // CFR-1.2 STRICT crawl class.
  //
  // ITS OWN approval_required MUST REMAIN FALSE, FOREVER. If deciding could itself require a
  // decision, the governance model recurses without a base case. `effectiveApprovalRequired` refuses
  // to return true for this skill no matter what a grant override says, so the invariant cannot be
  // undone by data — and because coordination skills are not mirrored by `seedGovernedSkills`, no
  // policy row exists to be edited into requiring one.
  { skillId: DECIDE_SKILL, version: 1, description: "Decide a pending governed action (approve or reject)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator" },

  // vNext Slice 2A — Pursuit Coordination. Two INTERNAL_WRITE skills and nothing else: a
  // recommendation is a proposal (system, agent or person may record one), and only a PERSON
  // decides. Neither can reach the outbox or a provider — the plan may stage an action onto the
  // motion's own queue; it never executes one. Handlers load lazily, like the P1C/P2B skills.
  { skillId: "recommend_pursuit_plan", version: 1, description: "Record PursuitOS's recommended pursuit plan (a proposal — never in force until a person decides)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER", "AGENT", "WORKER", "SYSTEM"], requiredPermission: "operator", precheck: pursuitInOrg,
    handler: async (db, actor, ctx) => (await import("../coordination/plan-store")).recordPlanRecommendation(
      db, { type: actor.type, id: actor.id ?? null, orgId: actor.orgId }, String(ctx.pursuitId),
      { env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION", correlationId: ctx.correlationId ?? null,
        effects: effectSinkOf(ctx), invocationId: observedInvocationId(ctx) }) },
  { skillId: "decide_pursuit_plan", version: 1, description: "Approve, adjust or decline a recommended pursuit plan (human decision)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: pursuitInOrg,
    handler: async (db, actor, ctx) => (await import("../coordination/plan-store")).decidePlan(
      db, { type: actor.type, id: actor.id ?? null, orgId: actor.orgId },
      {
        pursuitId: String(ctx.pursuitId), planId: String(ctx.args?.planId), recommendationId: String(ctx.args?.recommendationId),
        decision: String(ctx.args?.decision) as "APPROVED" | "ADJUSTED" | "REJECTED",
        adjustments: (ctx.args?.adjustments as import("../read-models/pursuit-plan").PlanAdjustments | undefined) ?? undefined,
        reason: ctx.args?.reason ? String(ctx.args.reason) : null,
      },
      { env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION", correlationId: ctx.correlationId ?? null , effects: effectSinkOf(ctx), invocationId: observedInvocationId(ctx) }) },
  // Replacing the COMMERCIAL OBJECTIVE itself (D-033) — a person only, with a reason. Append-only:
  // the old goal keeps its meaning and is superseded; the new goal names it. A route, motion or
  // action change never comes here — those are plan decisions above.
  { skillId: "replace_pursuit_goal", version: 1, description: "Replace a pursuit's commercial objective with a genuinely different one (human decision; history preserved)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator", precheck: pursuitInOrg,
    handler: async (db, actor, ctx) => (await import("../coordination/plan-store")).replacePursuitGoal(
      db, { type: actor.type, id: actor.id ?? null, orgId: actor.orgId },
      {
        pursuitId: String(ctx.pursuitId), objective: String(ctx.args?.objective ?? ""),
        targetDate: ctx.args?.targetDate ? String(ctx.args.targetDate) : null, reason: String(ctx.args?.reason ?? ""),
      },
      { env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION", correlationId: ctx.correlationId ?? null }) },
];

/** Tenant guard for pursuit-scoped skills: the pursuit id in the request must belong to the actor's org. */
async function pursuitInOrg(db: PoolClient, actor: Actor, ctx: DispatchCtx): Promise<{ ok: boolean; reason?: string }> {
  if (!ctx.pursuitId) return { ok: false, reason: "missing pursuitId" };
  const { rows } = await db.query(`select 1 from pursuits where id = $1 and org_id = $2`, [ctx.pursuitId, actor.orgId]);
  return rows[0] ? { ok: true } : { ok: false, reason: "pursuit not found in this org" };
}

/**
 * Tenant guard for team-member skills (R9 precondition). A member id is a bare uuid in the
 * request; before we transition it we prove it belongs to the actor's org and pursuit. A
 * cross-tenant member id is a governed REJECTION (audited), not a silent failure.
 */
async function teamMemberInOrg(db: PoolClient, actor: Actor, ctx: DispatchCtx): Promise<{ ok: boolean; reason?: string }> {
  const memberId = ctx.args?.memberId ? String(ctx.args.memberId) : null;
  if (!memberId) return { ok: false, reason: "missing memberId" };
  const { rows } = await db.query<{ pursuit_id: string }>(
    `select pursuit_id from pursuit_team_members where id = $1 and org_id = $2`, [memberId, actor.orgId]);
  if (!rows[0]) return { ok: false, reason: "team member not found in this org" };
  if (ctx.pursuitId && rows[0].pursuit_id !== ctx.pursuitId) return { ok: false, reason: "team member does not belong to this pursuit" };
  return { ok: true };
}

/** Tenant guard for motion-scoped skills: the motion id in the request must belong to the actor's org. */
async function motionInOrg(db: PoolClient, actor: Actor, ctx: DispatchCtx): Promise<{ ok: boolean; reason?: string }> {
  const motionId = ctx.args?.motionId ? String(ctx.args.motionId) : null;
  if (!motionId) return { ok: false, reason: "missing motionId" };
  const { rows } = await db.query(`select 1 from revenue_motions where id = $1 and org_id = $2`, [motionId, actor.orgId]);
  return rows[0] ? { ok: true } : { ok: false, reason: "motion not found in this org" };
}

function defFor(skillId: string, version?: number): SkillDef | undefined {
  const matches = [...SKILL_REGISTRY, ...COORDINATION_SKILLS].filter((s) => s.skillId === skillId);
  if (!matches.length) return undefined;
  return version ? matches.find((s) => s.version === version) : matches.sort((a, b) => b.version - a.version)[0];
}

/** Mirror the code registry's governance metadata into governed_skills (idempotent). */
export async function seedGovernedSkills(db: PoolClient): Promise<void> {
  for (const s of SKILL_REGISTRY) {
    await db.query(
      `insert into governed_skills (skill_id, version, description, effect_class, eligible_actors, required_permission, action_family)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (skill_id, version) do update set description = excluded.description,
         effect_class = excluded.effect_class, eligible_actors = excluded.eligible_actors,
         required_permission = excluded.required_permission, action_family = excluded.action_family`,
      [s.skillId, s.version, s.description, s.effectClass, s.eligibleActors, s.requiredPermission, s.actionFamily ?? null],
    );
  }
}

const MAX_CHAIN = 25;   // R23 loop guard
async function chainDepth(db: PoolClient, correlationId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`select count(*)::text n from governed_action_invocations where correlation_id = $1`, [correlationId]);
  return Number(rows[0].n);
}

/**
 * The governed-action chokepoint. Every governed commercial mutation passes here.
 * Returns the invocation status; it never throws for a policy rejection (the
 * REJECTED invocation is the audit record).
 */
export async function dispatchSkill(db: PoolClient, skillId: string, actor: Actor, ctx: DispatchCtx = {}): Promise<DispatchResult> {
  const def = defFor(skillId, ctx.args && (ctx as { version?: number }).version);
  if (!def) return { status: "REJECTED", invocationId: null, reason: `Unknown skill ${skillId}` };

  // P45-4. The authority instrument this dispatch ran on, carried forward from the ONE query that
  // authorized it to the audit row that records it. It is never re-derived afterwards: a second
  // lookup would be a guess about which grant applied, and an audit row must not guess.
  let grantUsed: LiveGrant | null = null;

  // P8-0. THE CANONICAL INVOCATION ID, ALLOCATED HERE BY THE SERVER — before any guard, before the
  // handler, and never from a payload. The same value reaches the handler's ledger writes, the
  // terminal invocation row and its effect refs, so a future evaluator joins on one identity rather
  // than on proximity. This is possible only because `change_ledger.invocation_id` carries NO
  // foreign key (0109's convention), so a ledger row may name an invocation whose row is inserted a
  // few statements later in the same transaction.
  //
  // The lifecycle is UNCHANGED: still one terminal INSERT, still after the handler.
  const invocationId = randomUUID();
  // The v1 marker is per-invocation AND per-capability. An unregistered capability is never marked,
  // even on a P8-0 runtime — 0117's CHECK refuses it at the database if this ever drifts.
  const observationVersion = coveredByV1(skillId, def.version) ? P8_OBSERVATION_CONTRACT_V1 : null;
  const obs = { invocationId, observationVersion };
  // Handlers reach the observation through a module-private symbol on a COPY of the caller's
  // context; the caller's object is never mutated and cannot supply one.
  ctx = withObservation(ctx, invocationId);

  // Idempotency: a prior invocation with this key wins.
  if (ctx.idempotencyKey) {
    const { rows } = await db.query<{ id: string; status: string }>(
      `select id, status from governed_action_invocations where org_id = $1 and skill_id = $2 and idempotency_key = $3`,
      [actor.orgId, skillId, ctx.idempotencyKey]);
    if (rows[0]) return { status: rows[0].status, invocationId: rows[0].id, reason: "idempotent replay" };
  }

  // Actor eligibility + permission (R9).
  if (!def.eligibleActors.includes(actor.type))
    return record(db, def, actor, ctx, "REJECTED", { reason: `actor ${actor.type} not eligible`, ...obs });
  if (ROLE_RANK[actor.role ?? "any"] < ROLE_RANK[def.requiredPermission])
    return record(db, def, actor, ctx, "REJECTED", { reason: `insufficient permission (needs ${def.requiredPermission})`, ...obs });

  // P45-4 MANDATORY BINDING FOR AGENTS. Being an AGENT confers zero authority: under enforcement an
  // agent must act on a durable governed actor resolved from its CREDENTIAL, never on the strength
  // of a key scope. Scoped to AGENT only — WORKER and SYSTEM keep their legacy behaviour, because
  // capturing them here would pull the EXTERNAL_ACTION send path into a slice that must not touch
  // sending. Absent/OFF preserves the certified Slice 14 contract exactly.
  if (governedAgentEnforcementEnabled() && actor.type === "AGENT" && !ctx.governedActorId)
    return record(db, def, actor, ctx, "REJECTED",
      { reason: "this deployment requires an AGENT to act as a governed actor", ...obs });

  // P45-1 governed-actor gate (ADDITIVE). Engages whenever a caller names a governed actor; it
  // can reject, never permit. Ordered after eligibility/permission on purpose — a grant must not be
  // able to rescue an actor type or role the registry already refused.
  //
  // NOTE FOR ROLLOUT (P45-4 §22.8): this gate demands a grant whenever `governedActorId` is present,
  // INDEPENDENTLY of the enforcement switch. Binding a credential is therefore NOT inert — from the
  // moment a bound credential exists it must already hold the grant for its intended action, which
  // is why provisioning creates the actor, then the grant, then mints the bound key.
  if (ctx.governedActorId) {
    const { rows: ga } = await db.query<{ actor_type: string; lifecycle: string; principal_user_id: string | null }>(
      `select actor_type, lifecycle, principal_user_id from governed_actors where id = $1 and org_id = $2`,
      [ctx.governedActorId, actor.orgId]);
    // Same-org is enforced by the predicate above, so a foreign actor id simply does not resolve —
    // it is reported as unknown rather than as a permission failure, which would leak its existence.
    if (!ga[0]) return record(db, def, actor, ctx, "REJECTED", { reason: "unknown governed actor", ...obs });
    if (ga[0].lifecycle !== "ACTIVE")
      return record(db, def, actor, ctx, "REJECTED", { reason: `governed actor is ${ga[0].lifecycle}`, ...obs });
    if (ga[0].actor_type !== actor.type)
      return record(db, def, actor, ctx, "REJECTED", { reason: "governed actor type does not match the acting actor", ...obs });
    // A USER actor must be acting for its own principal. `actor.id` is the caller's user identity;
    // where the deployment has no user identity at all (demo/Basic-Auth, where auth.users is empty)
    // both sides are null and this is vacuously satisfied — it can never pass a MISMATCH.
    if (ga[0].actor_type === "USER" && (ga[0].principal_user_id ?? null) !== (actor.id ?? null))
      return record(db, def, actor, ctx, "REJECTED", { reason: "governed actor principal does not match the acting user", ...obs });
    // ONE definition of liveness (status / revocation / expiry), shared with staleAuthority — see
    // runtime/grant-liveness.ts. EXACT VERSION for strict AGENT execution: the legacy NULL wildcard
    // remains valid for every pre-existing caller, but it does not satisfy P45-4, where the
    // authorizing instrument must name the capability version it authorizes.
    const exactVersion = governedAgentEnforcementEnabled() && actor.type === "AGENT";
    grantUsed = await liveGrantFor(db, actor.orgId, ctx.governedActorId, skillId, def.version, { exactVersion });
    // The refusal names no grant. Saying "expired" rather than "missing" would tell a caller that a
    // grant exists, which is the same disclosure the unknown-actor refusal above already refuses to
    // make. One reason, whatever the cause.
    if (!grantUsed) return record(db, def, actor, ctx, "REJECTED", { reason: "no active capability grant for this skill", ...obs });
  }

  // Loop guard (R23).
  if (ctx.correlationId && (await chainDepth(db, ctx.correlationId)) >= MAX_CHAIN)
    return record(db, def, actor, ctx, "REJECTED", { reason: "loop guard: action chain too deep", grantId: grantUsed?.id, ...obs });

  // Preconditions (R9).
  if (def.precheck) {
    const pc = await def.precheck(db, actor, ctx);
    if (!pc.ok) return record(db, def, actor, ctx, "REJECTED", { reason: pc.reason ?? "precondition failed", grantId: grantUsed?.id, ...obs });
  }

  // Effect-class routing.
  if (def.effectClass === "CROSS_TENANT_ACTION") {
    // A skill may supply its own authority fabric (e.g. partnership consent); otherwise
    // the default is a federation context-grant ACTION authority (R24).
    const authz = def.authorize
      ? await def.authorize(db, actor, ctx)
      : { ok: ctx.pursuitId ? await hasActionAuthority(db, actor.orgId, ctx.pursuitId, def.actionFamily ?? skillId) : false };
    if (!authz.ok) return record(db, def, actor, ctx, "REJECTED", { reason: authz.reason ?? "no cross-tenant action authority (R24)", grantId: grantUsed?.id, ...obs });
  }
  if (def.effectClass === "EXTERNAL_ACTION") {
    // Never execute inline — enqueue the transactional outbox (R25/G4). The executor,
    // not this handler, performs the side effect; the receipt + EXECUTED land when it
    // drains. Idempotency at the transport: (org, idempotency_key) is unique, so a
    // retried enqueue of the same authorized action collapses to the existing row.
    // EXTERNAL_ACTION is OUT OF P8-0 SCOPE: this row is inserted BEFORE the effect exists, so marking
    // it would certify completeness the runtime cannot possess. It carries the server id, never the marker.
    const inv = await record(db, def, actor, ctx, "EXECUTING", { grantId: grantUsed?.id, invocationId });
    await db.query(
      `insert into action_outbox
         (invocation_id, org_id, provider, action_family, payload, status, idempotency_key, correlation_id, data_environment)
       values ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8)
       on conflict (org_id, idempotency_key) where idempotency_key is not null do nothing`,
      [inv.invocationId, actor.orgId, def.provider ?? "unknown", def.actionFamily ?? null, JSON.stringify(ctx.args ?? {}),
       ctx.idempotencyKey ?? null, ctx.correlationId ?? null, ctx.dataEnvironment ?? "PRODUCTION"]);
    return { ...inv, queued: true };
  }

  // READ / INTERNAL_WRITE / authorized CROSS_TENANT → run the bound handler.
  //
  // Wave 6B §6. The handler runs inside a SAVEPOINT, and this is not a detail.
  //
  // A handler that fails against the DATABASE — an RLS refusal on a cross-tenant
  // write, a constraint violation, a check that fires — aborts the enclosing
  // transaction. The `catch` below then tried to write the FAILED audit row on
  // that same aborted transaction, so Postgres refused it with 25P02 and the
  // exception that escaped was "current transaction is aborted" rather than the
  // real cause. Two consequences, both bad on a product whose proposition is
  // governed action: the audit row for the failure was silently LOST, and every
  // later statement on that connection failed for an unrelated reason.
  //
  // The savepoint makes the guarantee hold: the prohibited or failing action is
  // rolled back to a known point, nothing it attempted persists, the rejection
  // IS recorded, and the caller's transaction remains usable afterwards. Tenant
  // enforcement is untouched — the refusal still refuses; it is only the audit
  // and the transaction state that are repaired.
  const sp = `sp_dispatch_${Math.random().toString(36).slice(2, 10)}`;
  await db.query(`savepoint ${sp}`);
  try {
    const result = def.handler ? await def.handler(db, actor, ctx) : { ok: true };
    await db.query(`release savepoint ${sp}`);
    // The invocation row first, then its effects: the composite FK needs the parent to exist. If the
    // effect INSERT fails, the exception escapes this function (the catch below is already closed),
    // the caller's transaction aborts, and neither the business mutation nor this row commits.
    const done = await record(db, def, actor, ctx, "EXECUTED", { result, grantId: grantUsed?.id, ...obs });
    await persistEffects(db, actor.orgId, invocationId, drainEffects(ctx));
    return done;
  } catch (e) {
    // Back to the known point BEFORE anything else touches this connection.
    await db.query(`rollback to savepoint ${sp}`);
    await db.query(`release savepoint ${sp}`);
    // P8-0 THE FAILURE RULE. The savepoint rewound the database; it did NOT rewind JavaScript. A
    // handler that staged effects and then threw would otherwise leave this FAILED row claiming
    // effects that never persisted.
    discardEffects(ctx);
    return record(db, def, actor, ctx, "FAILED", { reason: (e as Error).message, error: (e as Error).message, grantId: grantUsed?.id, ...obs });
  }
}

/**
 * Drain the external-action outbox (R25/R26). The real provider integration lands
 * later; here a simulated provider produces a receipt so the boundary is exercised
 * end to end. Marks the outbox row SUCCEEDED, writes an action_receipt (operational
 * proof PursuitOS DID something), and completes the invocation. Idempotent per row.
 */
export async function drainActionOutbox(db: PoolClient, opts: { simulate?: boolean } = {}): Promise<number> {
  const { rows } = await db.query<{ id: string; invocation_id: string; org_id: string; provider: string; action_family: string | null }>(
    `select id, invocation_id, org_id, provider, action_family from action_outbox where status = 'PENDING' for update skip locked`,
  );
  let n = 0;
  for (const o of rows) {
    const providerActionId = `${o.provider}-${o.id.slice(0, 8)}`;
    const status = opts.simulate === false ? "DISPATCHED" : "SUCCEEDED";
    await db.query(`update action_outbox set status = $2, attempts = attempts + 1, updated_at = now() where id = $1`, [o.id, status]);
    if (status === "SUCCEEDED") {
      await db.query(
        `insert into action_receipts (invocation_id, outbox_id, org_id, provider, provider_action_id, status, submitted_at, completed_at, detail)
         values ($1,$2,$3,$4,$5,'accepted', now(), now(), $6)`,
        [o.invocation_id, o.id, o.org_id, o.provider, providerActionId, JSON.stringify({ actionFamily: o.action_family, simulated: true })]);
      await db.query(`update governed_action_invocations set status = 'EXECUTED', executed_at = now() where id = $1`, [o.invocation_id]);
    }
    n++;
  }
  return n;
}

async function record(db: PoolClient, def: SkillDef, actor: Actor, ctx: DispatchCtx, status: string, extra: { reason?: string; result?: unknown; error?: string; grantId?: string | null; invocationId?: string; observationVersion?: number | null }): Promise<DispatchResult> {
  const executed = status === "EXECUTED" || status === "EXECUTING";
  const { rows } = await db.query<{ id: string }>(
    `insert into governed_action_invocations
       (org_id, skill_id, skill_version, effect_class, actor_type, actor_id, actor_role, pursuit_id,
        target_kind, target_id, args, idempotency_key, status, reason, causation_id, correlation_id,
        executed_at, result, error, data_environment, governed_actor_id, run_step_id, grant_id,
        id, observation_contract_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, case when $13 in ('EXECUTED','EXECUTING') then now() else null end, $17,$18,$19,$20,$21,$22,
             coalesce($23::uuid, gen_random_uuid()), $24)
     returning id`,
    [actor.orgId, def.skillId, def.version, def.effectClass, actor.type, actor.id ?? null, actor.role,
     ctx.pursuitId ?? null, ctx.target?.kind ?? null, ctx.target?.id ?? null, JSON.stringify(ctx.args ?? {}),
     ctx.idempotencyKey ?? null, status, extra.reason ?? null, ctx.causationId ?? null, ctx.correlationId ?? null,
     extra.result !== undefined ? JSON.stringify(extra.result) : null, extra.error ?? null, ctx.dataEnvironment ?? "PRODUCTION",
     ctx.governedActorId ?? null, ctx.runStepId ?? null, extra.grantId ?? null,
     extra.invocationId ?? null, extra.observationVersion ?? null],
  );
  void executed;
  // OR-3: surface governed-action rejections/failures. Cross-tenant authority denial is
  // a tenant-isolation signal; a handler error is a governed-action failure. Ids +
  // reason code only — args/result/payload never leave the DB.
  if (status === "REJECTED" || status === "FAILED") {
    const crossTenant = def.effectClass === "CROSS_TENANT_ACTION" && /authority|R24/i.test(extra.reason ?? "");
    reportEvent({
      kind: status === "FAILED" ? "governed_action" : crossTenant ? "tenant_isolation_failure" : "dispatch_skill",
      severity: status === "FAILED" ? "error" : crossTenant ? "warning" : "info",
      message: `${def.skillId} ${status}${extra.reason ? `: ${extra.reason}` : ""}`,
      orgId: actor.orgId, pursuitId: ctx.pursuitId ?? null, actionInvocationId: rows[0].id,
      correlationId: ctx.correlationId ?? null, effectClass: def.effectClass, environment: ctx.dataEnvironment ?? "PRODUCTION",
    });
  }
  return { status, invocationId: rows[0].id, reason: extra.reason, result: extra.result };
}
