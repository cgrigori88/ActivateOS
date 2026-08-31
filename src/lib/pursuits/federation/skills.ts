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
}
export interface DispatchResult { status: string; invocationId: string | null; reason?: string; result?: unknown; queued?: boolean }

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
    eligibleActors: ["USER"], requiredPermission: "operator",
    handler: async (db, actor, ctx) => selectRouteByCandidate(db, String(ctx.pursuitId), String(ctx.args?.candidateKey), {
      actorId: actor.id ?? null, env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION", correlationId: ctx.correlationId ?? null }) },
  { skillId: "override_partner_route", version: 1, description: "Override the recommended partner route (human decision)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator",
    handler: async (db, actor, ctx) => selectRouteByCandidate(db, String(ctx.pursuitId), String(ctx.args?.candidateKey), {
      actorId: actor.id ?? null, reason: ctx.args?.reason ? String(ctx.args.reason) : undefined,
      category: (ctx.args?.category as OverrideCategory) ?? "OTHER", env: (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION",
      correlationId: ctx.correlationId ?? null }) },
  { skillId: "explain_partner_route", version: 1, description: "Explain the route candidate comparison (read-only)", effectClass: "READ",
    eligibleActors: ["USER", "AGENT", "WORKER", "SYSTEM"], requiredPermission: "viewer",
    handler: async () => ({ explained: true }) },
  { skillId: "accept_participation", version: 1, description: "Accept a Pursuit participation invitation", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator",
    handler: async (db, _a, ctx) => { await acceptParticipation(db, String(ctx.args?.participantId)); return { accepted: true }; } },
  // Pursuit Team — governed confirmation lifecycle (Phase C1). A recommended team is a
  // proposal; only these governed decisions move a member off RECOMMENDED. Recompute may
  // change the recommendation (assembleTeam is idempotent and skips confirmed roles), but it
  // may never silently remove a confirmed human assignment. All reuse `transitionMember`
  // (the one team-status mutation), which records the append-only TEAM_MEMBER_* event.
  { skillId: "assemble_pursuit_team", version: 1, description: "Assemble the recommended pursuit team from the selected route", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER", "SYSTEM"], requiredPermission: "operator",
    handler: async (db, _a, ctx) => assembleTeam(db, String(ctx.pursuitId), (ctx.dataEnvironment as DataEnvironment) ?? "PRODUCTION") },
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
    eligibleActors: ["USER"], requiredPermission: "operator",
    handler: async (db, _a, ctx) => approveMotion(db, String(ctx.args?.motionId), (ctx.args?.edits as Partial<Record<EditableField, string>>) ?? {}) },
  { skillId: "reject_motion", version: 1, description: "Reject a draft revenue motion (human gate)", effectClass: "INTERNAL_WRITE",
    eligibleActors: ["USER"], requiredPermission: "operator",
    handler: async (db, _a, ctx) => { await rejectMotion(db, String(ctx.args?.motionId), ctx.args?.note ? String(ctx.args.note) : undefined); return { rejected: true }; } },
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
    handler: async (db, actor, ctx) => draftTouchImpl(db, actor.orgId, ctx.args ?? {}) },
  { skillId: "request_warm_intro", version: 1, description: "Request a warm introduction into a named-overlap account (cross-tenant)", effectClass: "CROSS_TENANT_ACTION",
    eligibleActors: ["USER", "AGENT"], requiredPermission: "operator", actionFamily: "intro.request",
    authorize: async (db, actor, ctx) => warmIntroAuthorize(db, actor.orgId, ctx.args ?? {}),
    handler: async (db, actor, ctx) => requestWarmIntroImpl(db, actor.orgId, ctx.args ?? {}) },
];

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

function defFor(skillId: string, version?: number): SkillDef | undefined {
  const matches = SKILL_REGISTRY.filter((s) => s.skillId === skillId);
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

  // Idempotency: a prior invocation with this key wins.
  if (ctx.idempotencyKey) {
    const { rows } = await db.query<{ id: string; status: string }>(
      `select id, status from governed_action_invocations where org_id = $1 and skill_id = $2 and idempotency_key = $3`,
      [actor.orgId, skillId, ctx.idempotencyKey]);
    if (rows[0]) return { status: rows[0].status, invocationId: rows[0].id, reason: "idempotent replay" };
  }

  // Actor eligibility + permission (R9).
  if (!def.eligibleActors.includes(actor.type))
    return record(db, def, actor, ctx, "REJECTED", { reason: `actor ${actor.type} not eligible` });
  if (ROLE_RANK[actor.role ?? "any"] < ROLE_RANK[def.requiredPermission])
    return record(db, def, actor, ctx, "REJECTED", { reason: `insufficient permission (needs ${def.requiredPermission})` });

  // Loop guard (R23).
  if (ctx.correlationId && (await chainDepth(db, ctx.correlationId)) >= MAX_CHAIN)
    return record(db, def, actor, ctx, "REJECTED", { reason: "loop guard: action chain too deep" });

  // Preconditions (R9).
  if (def.precheck) {
    const pc = await def.precheck(db, actor, ctx);
    if (!pc.ok) return record(db, def, actor, ctx, "REJECTED", { reason: pc.reason ?? "precondition failed" });
  }

  // Effect-class routing.
  if (def.effectClass === "CROSS_TENANT_ACTION") {
    // A skill may supply its own authority fabric (e.g. partnership consent); otherwise
    // the default is a federation context-grant ACTION authority (R24).
    const authz = def.authorize
      ? await def.authorize(db, actor, ctx)
      : { ok: ctx.pursuitId ? await hasActionAuthority(db, actor.orgId, ctx.pursuitId, def.actionFamily ?? skillId) : false };
    if (!authz.ok) return record(db, def, actor, ctx, "REJECTED", { reason: authz.reason ?? "no cross-tenant action authority (R24)" });
  }
  if (def.effectClass === "EXTERNAL_ACTION") {
    // Never execute inline — enqueue the transactional outbox (R25/G4). The executor,
    // not this handler, performs the side effect; the receipt + EXECUTED land when it
    // drains. Idempotency at the transport: (org, idempotency_key) is unique, so a
    // retried enqueue of the same authorized action collapses to the existing row.
    const inv = await record(db, def, actor, ctx, "EXECUTING", {});
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
  try {
    const result = def.handler ? await def.handler(db, actor, ctx) : { ok: true };
    return record(db, def, actor, ctx, "EXECUTED", { result });
  } catch (e) {
    return record(db, def, actor, ctx, "FAILED", { reason: (e as Error).message, error: (e as Error).message });
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

async function record(db: PoolClient, def: SkillDef, actor: Actor, ctx: DispatchCtx, status: string, extra: { reason?: string; result?: unknown; error?: string }): Promise<DispatchResult> {
  const executed = status === "EXECUTED" || status === "EXECUTING";
  const { rows } = await db.query<{ id: string }>(
    `insert into governed_action_invocations
       (org_id, skill_id, skill_version, effect_class, actor_type, actor_id, actor_role, pursuit_id,
        target_kind, target_id, args, idempotency_key, status, reason, causation_id, correlation_id,
        executed_at, result, error, data_environment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, case when $13 in ('EXECUTED','EXECUTING') then now() else null end, $17,$18,$19)
     returning id`,
    [actor.orgId, def.skillId, def.version, def.effectClass, actor.type, actor.id ?? null, actor.role,
     ctx.pursuitId ?? null, ctx.target?.kind ?? null, ctx.target?.id ?? null, JSON.stringify(ctx.args ?? {}),
     ctx.idempotencyKey ?? null, status, extra.reason ?? null, ctx.causationId ?? null, ctx.correlationId ?? null,
     extra.result !== undefined ? JSON.stringify(extra.result) : null, extra.error ?? null, ctx.dataEnvironment ?? "PRODUCTION"],
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
