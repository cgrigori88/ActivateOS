import { experienceReadiness } from "../experience-flags";

/**
 * Federation feature flag (Workstream E, R42). The federated-Pursuit layer ships
 * DARK behind FEDERATION_ENABLED (default OFF). It DEPENDS on the Pursuit
 * experience it federates, so the gate fails safe: OFF unless FEDERATION_ENABLED
 * is requested AND the underlying pursuits/facts/routing layers are ready.
 * Flipping the env var back to unset is a clean, data-preserving rollback — the
 * additive 0080+ tables simply go unread.
 */

function requested(): boolean {
  const v = (process.env.FEDERATION_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

export interface FederationReadiness {
  requested: boolean;
  experienceReady: boolean;
  ready: boolean;
  missing: string[];
}

export function federationReadiness(): FederationReadiness {
  const req = requested();
  const exp = experienceReadiness();
  const missing: string[] = [];
  if (!exp.ready) missing.push(...(exp.missing.length ? exp.missing : ["PURSUIT_EXPERIENCE_ENABLED"]));
  return { requested: req, experienceReady: exp.ready, ready: req && exp.ready, missing };
}

/** True iff the federated-Pursuit layer should be active (requested AND deps ready). */
export function federationEnabled(): boolean {
  return federationReadiness().ready;
}

function requestedGovernedAction(): boolean {
  const v = (process.env.GOVERNED_ACTION_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/**
 * Governed action layer (E3-D). Ships DARK behind GOVERNED_ACTION_ENABLED and
 * DEPENDS on federation being ready (participation + consent). Fails safe: OFF
 * unless requested AND federation is ready.
 */
export function governedActionEnabled(): boolean {
  return requestedGovernedAction() && federationEnabled();
}
