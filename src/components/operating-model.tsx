import { OperatingSpine, type SpineNode, type SpineStep } from "./operating-spine";

/**
 * The revenue spine (Wave 3 §2) — GOAL → MOTION → PURSUITS → PIPELINE.
 *
 * Goals, Motions and Pipeline were three rooms that never said they were three
 * views of one thing: what we are trying to achieve, the play we run to achieve
 * it, where that play lands on real accounts, and the revenue it produces.
 *
 * Wave 6 §6: the presentation now lives in OperatingSpine, shared with the
 * execution and evidence spines. This file is the vocabulary only — the words,
 * their order, and where each one goes. No relationship is asserted here that
 * the schema does not already carry.
 */

export type ModelLevel = "goal" | "motion" | "pursuit" | "pipeline";
export type ModelStep = SpineStep;

const NODES: SpineNode[] = [
  { key: "goal", word: "Goal", asks: "what we are trying to achieve", href: "/goals" },
  { key: "motion", word: "Motion", asks: "the play we are running", href: "/motions" },
  { key: "pursuit", word: "Pursuits", asks: "where it lands on accounts", href: "/pursuits" },
  { key: "pipeline", word: "Pipeline", asks: "the revenue it produces", href: "/pipeline" },
];

export function OperatingModel({
  current,
  steps,
  className = "",
}: {
  current: ModelLevel;
  /** Per-level overrides. A level absent from this map still renders, unlinked to a specific record. */
  steps?: Partial<Record<ModelLevel, ModelStep>>;
  className?: string;
}) {
  return (
    <OperatingSpine label="Operating model" nodes={NODES} current={current} steps={steps} className={className} />
  );
}
