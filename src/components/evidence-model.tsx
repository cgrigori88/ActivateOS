import { OperatingSpine, type SpineNode, type SpineStep } from "./operating-spine";

/**
 * The evidence spine (Wave 5 §2/§11) —
 * INTAKE → SOURCES → FEED HEALTH → ASK → INSIGHTS → CONTACTS.
 *
 * Intake, Sources, Provider health, Ask, Insights and Contacts were six
 * unrelated entries in a sidebar. Each was individually defensible and none of
 * them said the thing that actually matters: that evidence enters at Intake, is
 * attributed to a Source, is only worth as much as that feed's health, is what
 * Ask reads from, is what Insights learns from, and resolves to the People a
 * seller has to reach. That chain is the product's claim to being governed
 * rather than generative.
 *
 * Wave 6 §6: presentation moved to OperatingSpine. This file is the vocabulary.
 */

export type EvidenceLevel = "intake" | "sources" | "health" | "ask" | "insights" | "contacts";
export type EvidenceStep = SpineStep;

const NODES: SpineNode[] = [
  { key: "intake", word: "Intake", asks: "what came in", href: "/intake" },
  { key: "sources", word: "Sources", asks: "who it came from", href: "/sources" },
  { key: "health", word: "Feed health", asks: "whether it can be trusted", href: "/provider-health" },
  { key: "ask", word: "Ask", asks: "what the record answers", href: "/ask" },
  { key: "insights", word: "Insights", asks: "what the outcomes taught us", href: "/insights" },
  { key: "contacts", word: "Contacts", asks: "who it resolves to", href: "/contacts" },
];

export function EvidenceModel({
  current,
  steps,
  className = "",
}: {
  current: EvidenceLevel;
  steps?: Partial<Record<EvidenceLevel, EvidenceStep>>;
  className?: string;
}) {
  return (
    <OperatingSpine label="Evidence model" nodes={NODES} current={current} steps={steps} className={className} />
  );
}
