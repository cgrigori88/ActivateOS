import type { SignalFamily } from "../signals/types";

/**
 * V1 propensity computation — pure, deterministic, explainable
 * (PROJECT_BRIEF §4.1). Every score preserves its feature contributions and
 * the evidence ids behind them. No model call anywhere in this file.
 */

export const SCORE_VERSION_LABEL = "v1-rules";

export const FEATURE_WEIGHTS: Record<string, number> = {
  technology_fit: 0.35,
  trigger_events: 0.25,
  strategic_initiative: 0.15,
  momentum: 0.15,
  partner_strength: 0.1,
};

const NEGATIVE_MAX_PENALTY = 30; // points
const ALREADY_INSTALLED_PENALTY = 15; // target tech already present → need likely satisfied

export interface ScorableSignal {
  signalType: string;
  family: SignalFamily;
  nodeSlug: string | null;
  direction: 1 | -1;
  magnitude: number;
  confidence: number;
  observedAt: Date;
  halfLifeDays: number;
  evidenceId: string;
  /** Known future event this signal points at (renewal date, refresh window). */
  eventDate?: Date | null;
}

/** Edge weight from an installed/related node toward the target solution node. */
export type EdgeMap = Map<string, { weight: number; edgeType: string }>;

export interface FeatureContribution {
  feature: string;
  contribution: number; // signed points contributed to the final score
  raw: number; // pre-weight raw feature value
  evidenceIds: string[];
}

export interface ScoreResult {
  score: number;
  band: "very_high" | "high" | "medium" | "low";
  features: FeatureContribution[];
}

export function decay(observedAt: Date, halfLifeDays: number, now: Date = new Date()): number {
  const ageDays = Math.max(0, (now.getTime() - observedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

const EVENT_RAMP_DAYS = 365; // horizon over which an approaching event ramps up
const EVENT_FLOOR = 0.35; // relevance of an event a full horizon away
const EVENT_PASSED_HALF_LIFE_DAYS = 30; // events fade fast once they're behind us

/**
 * Relevance of a signal anchored to a dated future event (BLUEPRINT: a
 * contract expiry becomes MORE relevant as the date approaches, the opposite
 * of ordinary evidence decay). Ramps from a floor one horizon out to 1.0 at
 * the event, then decays quickly once the event has passed.
 */
export function eventProximity(eventDate: Date, now: Date = new Date()): number {
  const daysUntil = (eventDate.getTime() - now.getTime()) / 86_400_000;
  if (daysUntil >= 0) {
    return EVENT_FLOOR + (1 - EVENT_FLOOR) * (1 - Math.min(1, daysUntil / EVENT_RAMP_DAYS));
  }
  return Math.pow(0.5, -daysUntil / EVENT_PASSED_HALF_LIFE_DAYS);
}

/** Unified time factor: dated events use proximity, everything else uses decay. */
export function timeRelevance(s: ScorableSignal, now: Date = new Date()): number {
  return s.eventDate ? eventProximity(s.eventDate, now) : decay(s.observedAt, s.halfLifeDays, now);
}

export function band(score: number): ScoreResult["band"] {
  if (score >= 80) return "very_high";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function computeScore(
  signals: ScorableSignal[],
  targetSlug: string,
  edgesIntoTarget: EdgeMap,
  now: Date = new Date(),
): ScoreResult {
  const acc = new Map<string, { raw: number; evidenceIds: string[] }>();
  const add = (feature: string, value: number, evidenceId: string) => {
    const entry = acc.get(feature) ?? { raw: 0, evidenceIds: [] };
    entry.raw += value;
    entry.evidenceIds.push(evidenceId);
    acc.set(feature, entry);
  };

  for (const s of signals) {
    const strength = s.magnitude * s.confidence * timeRelevance(s, now);
    if (strength <= 0) continue;

    if (s.direction === -1 || s.family === "negative") {
      add("negative_signals", strength, s.evidenceId);
      continue;
    }

    switch (s.family) {
      case "technology": {
        if (s.nodeSlug === targetSlug) {
          // Target already installed: the need is likely satisfied.
          add("already_installed", strength, s.evidenceId);
        } else if (s.nodeSlug && edgesIntoTarget.has(s.nodeSlug)) {
          add("technology_fit", strength * edgesIntoTarget.get(s.nodeSlug)!.weight, s.evidenceId);
        }
        break;
      }
      case "trigger":
        add("trigger_events", strength, s.evidenceId);
        break;
      case "initiative":
        add("strategic_initiative", strength, s.evidenceId);
        break;
      case "momentum":
        add("momentum", strength, s.evidenceId);
        break;
      case "partner":
        add("partner_strength", strength, s.evidenceId);
        break;
    }
  }

  const features: FeatureContribution[] = [];
  let score = 0;

  for (const [feature, weight] of Object.entries(FEATURE_WEIGHTS)) {
    const entry = acc.get(feature);
    if (!entry) continue;
    const normalized = Math.min(1, entry.raw);
    const points = normalized * weight * 100;
    score += points;
    features.push({ feature, contribution: points, raw: entry.raw, evidenceIds: entry.evidenceIds });
  }

  const negative = acc.get("negative_signals");
  if (negative) {
    const penalty = Math.min(1, negative.raw) * NEGATIVE_MAX_PENALTY;
    score -= penalty;
    features.push({
      feature: "negative_signals",
      contribution: -penalty,
      raw: negative.raw,
      evidenceIds: negative.evidenceIds,
    });
  }

  const installed = acc.get("already_installed");
  if (installed) {
    const penalty = Math.min(1, installed.raw) * ALREADY_INSTALLED_PENALTY;
    score -= penalty;
    features.push({
      feature: "already_installed",
      contribution: -penalty,
      raw: installed.raw,
      evidenceIds: installed.evidenceIds,
    });
  }

  const clamped = Math.max(0, Math.min(100, score));
  return { score: clamped, band: band(clamped), features };
}
