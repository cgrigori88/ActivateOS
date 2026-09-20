import type { ContextGap } from "../../src/lib/pursuits/read-models/missing-context";
import type { PlanState } from "../../src/lib/pursuits/read-models/pursuit-plan";

/**
 * A canonical plan state with ENOUGH RANKED GAPS TO ORDER.
 *
 * The Slice 2A fixture carries two gaps, which was all a single-action plan could ever use. Ordered
 * actions need a ranked list long enough to select from, deduplicate within and reorder — so this
 * one carries four gaps across four sources, producing four distinct action keys of which a v2 plan
 * takes the first three.
 *
 * It is a fixture, not a product constant: the shapes are the ones Missing Context actually emits.
 */
export function gap(over: Partial<ContextGap> = {}): ContextGap {
  return {
    key: "stakeholder:economic_buyer",
    source: "STAKEHOLDER_COVERAGE",
    kind: "MISSING",
    text: "No economic buyer identified.",
    whyItMatters: "Nobody can approve the spend.",
    howToResolve: "Customer confirms budget/approval ownership.",
    refType: "stakeholder_role",
    refId: "economic_buyer",
    rank: 90,
    rankReasons: ["blocking"],
    ...over,
  };
}

export function globexPlanState(over: Partial<PlanState> = {}): PlanState {
  return {
    pursuitId: "p-globex",
    accountLabel: "Globex Manufacturing Inc.",
    pursuitStatus: "DETECTED",
    businessProblem: "Exit legacy virtualization before renewal",
    opportunity: { id: "o-1", name: "Legacy virtualization exit", stage: "proposal", amountUsd: 920000, expectedClose: "2026-10-24" },
    route: { decided: true, selectedLabel: "WWT", recommendedLabel: "CDW", overridden: true },
    motion: { id: "m-1", label: "Virtualization", status: "active", partnerLabel: "WWT", linkage: "OPPORTUNITY", openActions: 1 },
    stakeholders: {
      established: true, withheld: false,
      roles: [
        { role: "economic_buyer", state: "MISSING", personName: null },
        { role: "champion", state: "VERIFIED", personName: "Sarah Kim" },
        { role: "technical_buyer", state: "VERIFIED", personName: "Mike Rivera" },
      ],
    },
    qualification: { metrics: "strong", economic_buyer: "strong", decision_process: "unknown", paper_process: "unknown", champion: "weak" },
    valueState: "INCOMPLETE",
    timing: { anchored: false, accountEvent: { label: "Renewal", date: "2026-11-29", state: "VERIFIED_DATE", factId: "f-renewal" } },
    // Four sources, four distinct action keys, strictly descending rank.
    gaps: [
      gap(),
      gap({
        key: "meddpicc:decision_process", source: "MEDDPICC", kind: "MISSING",
        text: "The decision process is unknown.", whyItMatters: null,
        howToResolve: "Map who signs and in what order.",
        refType: "meddpicc_element", refId: "decision_process", rank: 80,
      }),
      gap({
        key: "whynow:unknown:0", source: "WHY_NOW", kind: "MISSING",
        text: "No verified timing anchor for the renewal.", whyItMatters: null, howToResolve: null,
        refType: "pursuit", refId: "p-globex", rank: 72,
      }),
      gap({
        key: "value:downtime_cost", source: "VALUE_CASE", kind: "NOT_ESTABLISHED",
        text: "Downtime cost is not quantified.", whyItMatters: null,
        howToResolve: "Quantify the cost of an hour of downtime.",
        refType: "value_driver", refId: "downtime_cost", rank: 60,
      }),
    ],
    team: [
      { id: "tm-ae", role: "VENDOR_ACCOUNT_EXECUTIVE", status: "RECOMMENDED", personLabel: null, partnerLabel: null },
      { id: "tm-sp", role: "VENDOR_SPECIALIST", status: "RECOMMENDED", personLabel: null, partnerLabel: null },
      { id: "tm-sa", role: "VENDOR_SOLUTION_ARCHITECT", status: "ACCEPTED", personLabel: "Priya Raman", partnerLabel: null },
    ],
    warmPaths: [
      { tier: "SELLER_ACCOUNT", text: "WWT seller WWT Rep holds a strong relationship at this account.", via: "WWT", refType: "seller_account_relationships", refId: "s-wwt" },
    ],
    ...over,
  };
}
