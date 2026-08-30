/**
 * Routing capability registry (Workstream C, §43/§44/§45). Declares the governed routing
 * Skills and their side-effect class so Ask/MCP and Workstream H can enforce read vs write vs
 * cross-tenant boundaries. This is the DECLARATION + classification; the actual handlers live
 * in the routing services. Cross-tenant actions still require the consent fabric.
 */

export type SideEffectClass = "READ" | "INTERNAL_WRITE" | "CROSS_TENANT_ACTION";

export interface RoutingSkill { name: string; sideEffect: SideEffectClass; description: string; }

export const ROUTING_SKILLS: RoutingSkill[] = [
  { name: "rank_partner_routes", sideEffect: "READ", description: "Return ranked candidate routes for a pursuit with explainable scores." },
  { name: "explain_partner_route", sideEffect: "READ", description: "Explain why a route is recommended (internal or shareable)." },
  { name: "rank_sellers", sideEffect: "READ", description: "Rank candidate sellers for a pursuit." },
  { name: "assemble_pursuit_team", sideEffect: "INTERNAL_WRITE", description: "Assemble the recommended pursuit team." },
  { name: "select_partner_route", sideEffect: "INTERNAL_WRITE", description: "Record the human/policy route selection." },
  { name: "override_partner_route", sideEffect: "INTERNAL_WRITE", description: "Record a non-recommended route selection with reason + category." },
  { name: "request_team_acceptance", sideEffect: "CROSS_TENANT_ACTION", description: "Invite an external team member — requires consent." },
];

export function skillSideEffect(name: string): SideEffectClass | null {
  return ROUTING_SKILLS.find((s) => s.name === name)?.sideEffect ?? null;
}

/** True iff a skill may run under a READ-only authorization. */
export function isReadOnly(name: string): boolean {
  return skillSideEffect(name) === "READ";
}
