import { pursuitsEnabled } from "./flags";
import { factsEnabled } from "../facts/flags";
import { routingEnabled } from "../routing/flags";

/**
 * Pursuit Experience feature flag (Workstream D, §55/§56). The new decision surface ships DARK
 * behind PURSUIT_EXPERIENCE_ENABLED (default OFF) — when off, the current UI is untouched. The
 * experience DEPENDS on the domain layers it renders; enabling the surface without its data
 * layers would render a broken UX, so the gate fails safe: it reports OFF unless every required
 * layer is also on. `experienceReadiness()` exposes the dependency state for diagnostics.
 */

function rawExperienceEnabled(): boolean {
  const v = (process.env.PURSUIT_EXPERIENCE_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

export interface ExperienceReadiness {
  requested: boolean;
  pursuits: boolean;
  facts: boolean;
  routing: boolean;
  ready: boolean;
  missing: string[];
}

export function experienceReadiness(): ExperienceReadiness {
  const requested = rawExperienceEnabled();
  const pursuits = pursuitsEnabled();
  const facts = factsEnabled();
  const routing = routingEnabled();
  const missing: string[] = [];
  if (!pursuits) missing.push("PURSUITS_ENABLED");
  if (!facts) missing.push("FACTS_ENABLED");
  if (!routing) missing.push("ROUTING_ENABLED");
  return { requested, pursuits, facts, routing, ready: requested && missing.length === 0, missing };
}

/** True iff the Pursuit Experience should render (requested AND all dependencies satisfied). */
export function pursuitExperienceEnabled(): boolean {
  return experienceReadiness().ready;
}
