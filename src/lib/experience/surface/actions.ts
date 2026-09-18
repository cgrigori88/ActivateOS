/**
 * P7 Slice 9 — THE ACTION CAPABILITY REGISTRY. Declarative, closed, and consequential-free.
 *
 * > **A Dynamic Surface may present a governed action affordance. It may not execute, authorize or
 * > approve the action. Every consequential action remains a P5 operation under current authority.**
 *
 * ── THE SUBSTRATE IS PART OF THE CONTRACT ───────────────────────────────────────────────────────
 *
 * > **A Dynamic Surface may expose more than one consequential substrate over time, but the substrate
 * > is an explicit part of the registered action contract. P7 may not substitute one mutation/runtime
 * > substrate for another merely because both are "actions."**
 *
 * PursuitOS has two, and they are not interchangeable. `dispatchSkill` is the certified single
 * mutation authority the live Pursuit page already uses. The P45 governed-action runtime — plans,
 * runs, approvals — is double-gated and inert. Slice 9 names `DISPATCH_SKILL` explicitly on every
 * entry below, so "which consequential machinery does this affordance lead to" is a registry fact
 * rather than something inferred from a component's name.
 *
 * THIS MODULE IS NOT AN EXECUTION PATH. It holds no database handle, imports no dispatcher, and
 * contains no invocation of any kind. It answers two questions — *which registered operation does
 * this component stand for*, and *may this viewer be OFFERED it* — and nothing else. A suite proves
 * it reaches neither `dispatchSkill` nor the P45 runtime.
 */
import type { ComponentKey } from "./schema";

/** Which consequential machinery an affordance leads to. Named, never inferred. */
export type ActionSubstrate = "DISPATCH_SKILL";

/** The role ladder `dispatchSkill` itself uses. Mirrored for DISCLOSURE only — never for authority. */
const ROLE_RANK: Record<string, number> = { any: 0, viewer: 1, operator: 2, owner: 3 };

export interface ActionCapability {
  /** The consequential substrate. Part of the contract (ruling A). */
  substrate: ActionSubstrate;
  /** The EXACT registered capability. Fixed here; never supplied by a caller, a model or a browser. */
  skillId: string;
  version: number;
  subjectClass: "pursuit";
  /** Mirrors the skill's own `requiredPermission`. Used to decide whether to OFFER, never to permit. */
  requiredPermission: "viewer" | "operator" | "owner";
  /** Slice 9 has no implicit invocation, and the type records that rather than a comment. */
  explicitInvocation: true;
  /** No approval is involved in this capability. A future one reuses ITS substrate's semantics. */
  approval: "NONE";
  /** No caller- or model-authored arguments exist. There is no position for one (ruling E). */
  callerArguments: "NONE";
  /** Recipient-facing wording. Registry-owned, deterministic, never model prose. */
  interpretedAs: string;
}

/**
 * The closed action vocabulary. Adding an entry is a reviewed code change, and a new one must bring
 * its own invocation/idempotency contract before it may be surfaced:
 *
 * > **Registry eligibility for future non-idempotent actions requires an explicit
 * > invocation/idempotency contract before that action can be surfaced.**
 */
export const ACTION_CAPABILITIES: Partial<Record<ComponentKey, ActionCapability>> = {
  "pursuit.assemble_team": {
    substrate: "DISPATCH_SKILL",
    skillId: "assemble_pursuit_team",
    version: 1,
    subjectClass: "pursuit",
    requiredPermission: "operator",
    explicitInvocation: true,
    approval: "NONE",
    callerArguments: "NONE",
    interpretedAs: "Assemble the pursuit team",
  },
};

export const actionCapability = (key: ComponentKey): ActionCapability | undefined =>
  ACTION_CAPABILITIES[key];

/**
 * MAY THIS VIEWER BE OFFERED THIS OPERATION? A disclosure question, not an authorization.
 *
 * > **May disclose an action affordance ≠ may execute the action later.**
 *
 * It deliberately does NOT reproduce the dispatch pipeline. It does not consult governed actors,
 * grants, prechecks or `authorize` hooks — and above all it does not call `dispatchSkill`, because a
 * dispatch RECORDS AN ATTEMPT and an attempt is consequential state. Rendering a button must not
 * write an audit row.
 *
 * So this is the smallest honest question: does the current viewer hold at least the role the
 * registered capability requires? Everything else is decided again, by the real pipeline, on click.
 * The cost of that asymmetry is accepted deliberately: an affordance may occasionally be offered to
 * someone whose dispatch will still refuse. The reverse — permitting on render — is the failure this
 * separation exists to prevent.
 */
export function mayOffer(capability: ActionCapability, role: string | null): boolean {
  if (!role) return false;                       // no resolved role: fail closed, offer nothing
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[capability.requiredPermission];
}
