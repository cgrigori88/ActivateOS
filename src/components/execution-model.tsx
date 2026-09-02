import { OperatingSpine, type SpineNode, type SpineStep } from "./operating-spine";

/**
 * The execution spine (Wave 4 §2/§8) —
 * DECISION → QUEUE → SKILL → ROUTINE → EXECUTION → REVIEW → OUTCOME.
 *
 * Queue, Skills, Routines, Campaigns and Review were five utilities in a
 * sidebar. Nothing said that the Skill governs how the queued work is
 * performed, that the Routine decides when it recurs, that the Campaign is one
 * governed way it reaches the market, or that Review is where a human still has
 * to say yes.
 *
 * §2 is why this exists at all: recommendation, decision, action and outcome are
 * four different things, and a product that shows them as one "status" cannot be
 * trusted with authority. The spine keeps them visibly separate stages rather
 * than degrees of the same progress bar.
 *
 * Wave 6 §6: presentation moved to OperatingSpine. This file is the vocabulary.
 */

export type ExecLevel = "decision" | "queue" | "skill" | "routine" | "execution" | "review" | "outcome";
export type ExecStep = SpineStep;

const NODES: SpineNode[] = [
  { key: "decision", word: "Decision", asks: "what was concluded", href: "/pursuits" },
  { key: "queue", word: "Queue", asks: "what needs doing now", href: "/queue" },
  { key: "skill", word: "Skill", asks: "how we do this kind of work", href: "/skills" },
  { key: "routine", word: "Routine", asks: "when it repeats", href: "/routines" },
  { key: "execution", word: "Execution", asks: "how it reaches the market", href: "/campaigns" },
  { key: "review", word: "Review", asks: "where a human must agree", href: "/review" },
  { key: "outcome", word: "Outcome", asks: "what actually happened", href: "/insights" },
];

export function ExecutionModel({
  current,
  steps,
  className = "",
}: {
  current: ExecLevel;
  steps?: Partial<Record<ExecLevel, ExecStep>>;
  className?: string;
}) {
  return (
    <OperatingSpine label="Execution model" nodes={NODES} current={current} steps={steps} className={className} />
  );
}
