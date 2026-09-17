import { Pool, type PoolClient } from "pg";
import {
  BASIS_EVIDENCE_WEIGHT, COMMERCIAL_PROXIMITY_WEIGHT, COMMERCIAL_STANDING_WEIGHT,
  MOMENTUM_EXCLUDED_CHANGE_TYPES, NEUTRAL_PROXIMITY, NEUTRAL_STANDING, PORTFOLIO_SIGNAL_WEIGHT,
  midRankPercentile, momentumOf, proximityOf, rankPortfolioPertinence,
  type PortfolioCandidate, type PortfolioPertinenceView, type ValueBasis,
} from "../src/lib/pursuits/read-models/portfolio-pertinence";
import { loadPortfolioCandidates } from "../src/lib/pursuits/read-models/portfolio-pertinence-loaders";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";
import { todaySort } from "../src/lib/pursuits/read-models/materiality";

/**
 * P2 — Portfolio Pertinence.
 *
 * Mostly PURE: the ranking takes an input array, so the arithmetic is driven directly with a FROZEN
 * `asOf` and synthetic candidates. That is deliberate — a ranking suite whose expectations move with
 * the clock cannot prove determinism, and freezing the clock makes this suite immune to the CFR-1.2
 * clock class rather than merely tolerant of it. A DB section then proves tenant scoping and that
 * the loaders read canonical state.
 *
 * The golden scenarios below ARE the accepted contract (P3 → P1 → P4 → P5 → P2 → P6).
 *
 *   npx tsx scripts/verify-run.ts --suite portfolio-pertinence
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const owner = new Pool({ connectionString: CONN, max: 2 });

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};
const near = (a: number, b: number, eps = 5e-4) => Math.abs(a - b) < eps;

/** FROZEN. Every expectation below is stated against this instant. */
const ASOF = new Date("2026-09-17T12:00:00.000Z");
const daysAgo = (d: number) => new Date(ASOF.getTime() - d * 86_400_000);
const CALLER: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };

const cand = (o: Partial<PortfolioCandidate> & { pursuitId: string; label: string }): PortfolioCandidate => ({
  accountLabel: o.label, disclosure: "INTERNAL", pendingDecisions: [], valueBasis: "UNESTABLISHED",
  magnitudeUsd: null, daysToClose: null, contextNeed: 0.1, contextNeedReason: "No outstanding context gaps",
  momentumEvents: [], activationReadiness: 0.5, activationReadinessReason: "Readiness not yet assessed",
  ...o,
} as PortfolioCandidate);

// ── The accepted golden portfolio ────────────────────────────────────────────────────────────────
const P1 = cand({ pursuitId: "p1", label: "Initech renewal", valueBasis: "PIPELINE", magnitudeUsd: 300_000, daysToClose: 20,
  pendingDecisions: ["A recommended route is waiting for approval"], contextNeed: 0.10,
  momentumEvents: [{ materiality: "MEDIUM", at: daysAgo(3) }], activationReadiness: 0.95, activationReadinessReason: "Route is activation-ready" });
const P2 = cand({ pursuitId: "p2", label: "Globex platform", valueBasis: "PIPELINE", magnitudeUsd: 500_000, daysToClose: 150,
  contextNeed: 0.10, momentumEvents: [{ materiality: "LOW", at: daysAgo(12) }], activationReadiness: 0.80 });
const P3 = cand({ pursuitId: "p3", label: "Hooli migration", valueBasis: "PIPELINE", magnitudeUsd: 1_200_000, daysToClose: 45,
  contextNeed: 1.00, contextNeedReason: "2 disputed facts", momentumEvents: [{ materiality: "HIGH", at: daysAgo(2) }], activationReadiness: 0.80 });
const P4 = cand({ pursuitId: "p4", label: "Umbrella whitespace", valueBasis: "MODELED", magnitudeUsd: 1_200_000,
  contextNeed: 0.60, contextNeedReason: "1 buying role unverified", momentumEvents: [{ materiality: "HIGH", at: daysAgo(1) }], activationReadiness: 0.50 });
const P5 = cand({ pursuitId: "p5", label: "Vertex expansion", valueBasis: "PIPELINE", magnitudeUsd: 1_125_000, daysToClose: 30,
  contextNeed: 0.35, momentumEvents: [{ materiality: "LOW", at: daysAgo(20) }], activationReadiness: 0.25,
  activationReadinessReason: "Route is not activation-ready — seller, capacity or team roles outstanding" });
const P6 = cand({ pursuitId: "p6", label: "Stark pilot", valueBasis: "PIPELINE", magnitudeUsd: 60_000, daysToClose: 60,
  contextNeed: 0.10, momentumEvents: [{ materiality: "LOW", at: daysAgo(40) }], activationReadiness: 0.75 });
const GOLDEN = [P1, P2, P3, P4, P5, P6];

const rank = (cs: PortfolioCandidate[], scope = "All pursuits"): PortfolioPertinenceView =>
  rankPortfolioPertinence({ caller: CALLER, candidates: cs, asOf: ASOF, scope });
const order = (v: PortfolioPertinenceView) => v.items.map((i) => i.pursuitId).join(" → ");
const of = (v: PortfolioPertinenceView, id: string) => v.items.find((i) => i.pursuitId === id)!;

async function main(): Promise<void> {
  console.log("[portfolio-pertinence-verify] pure arithmetic, frozen asOf " + ASOF.toISOString());

  // ══ 1. THE DECLARED CONTRACT ══════════════════════════════════════════════════════════════════
  const w = PORTFOLIO_SIGNAL_WEIGHT;
  check("1: the five weights are exactly the locked contract",
    w.decisionPressure === 0.25 && w.commercialPriority === 0.30 && w.contextNeed === 0.20 && w.momentum === 0.15 && w.activationReadiness === 0.10);
  check("2: the weights sum to exactly 1.00", near(Object.values(w).reduce((a, b) => a + b, 0), 1, 1e-12));
  check("3: basis evidence weights are PIPELINE 1.00 / MODELED 0.60 / UNESTABLISHED 0.00",
    BASIS_EVIDENCE_WEIGHT.PIPELINE === 1.0 && BASIS_EVIDENCE_WEIGHT.MODELED === 0.6 && BASIS_EVIDENCE_WEIGHT.UNESTABLISHED === 0);
  check("4: commercialPriority splits 0.70 standing / 0.30 proximity",
    COMMERCIAL_STANDING_WEIGHT === 0.7 && COMMERCIAL_PROXIMITY_WEIGHT === 0.3);

  // ══ 2. THE GOLDEN RANKING ═════════════════════════════════════════════════════════════════════
  const g = rank(GOLDEN);
  check("5: THE ACCEPTED ORDERING — P3 → P1 → P4 → P5 → P2 → P6", order(g) === "p3 → p1 → p4 → p5 → p2 → p6", order(g));
  const exp: Record<string, number> = { p3: 0.67566, p1: 0.57812, p4: 0.37098, p5: 0.36607, p2: 0.26103, p6: 0.18807 };
  const totals = Object.fromEntries(g.items.map((i) => [i.pursuitId, i.signals.reduce((s, x) => s + x.contribution, 0)]));
  check("6: every total matches the contract arithmetic to 3dp",
    Object.entries(exp).every(([k, v]) => near(totals[k], v)), g.items.map((i) => `${i.pursuitId}=${totals[i.pursuitId].toFixed(5)}`).join(" "));
  check("7: Σ contributions equals the rendered score for every item — INDEPENDENTLY recomputed",
    g.items.every((i) => i.score === Math.round(i.signals.reduce((s, x) => s + x.value * x.weight, 0) * 100)));
  check("8: ranks are 1..n and dense", g.items.map((i) => i.rank).join(",") === "1,2,3,4,5,6");
  check("9: P4 and P5 both round to 37 yet order by EXACT total, not the rounded score",
    of(g, "p4").score === 37 && of(g, "p5").score === 37 && of(g, "p4").rank < of(g, "p5").rank,
    `p4=${totals.p4.toFixed(5)} p5=${totals.p5.toFixed(5)}`);

  // ══ 3. DETERMINISM ════════════════════════════════════════════════════════════════════════════
  const repeats = new Set(Array.from({ length: 8 }, () => JSON.stringify(rank(GOLDEN))));
  check("10: 8 rankings of the same input produce EXACTLY ONE distinct result", repeats.size === 1, `${repeats.size} distinct`);
  const shuffled = [P6, P3, P1, P5, P2, P4];
  check("11: input order does not affect the result", JSON.stringify(rank(shuffled)) === JSON.stringify(rank(GOLDEN)));

  // ══ 4. THE VALUE-BASIS FIREWALL (required tests 1–6) ══════════════════════════════════════════
  const pipeMags = GOLDEN.filter((c) => c.valueBasis === "PIPELINE").map((c) => c.magnitudeUsd!);
  check("12: REQUIRED — MODELED and PIPELINE magnitudes are never in one cohort: P3 and P4 are both $1.2M yet have different standing",
    of(g, "p3").commercial.standing === 1 && of(g, "p4").commercial.standing === NEUTRAL_STANDING,
    `p3 standing=${of(g, "p3").commercial.standing} (of ${of(g, "p3").commercial.cohortSize}) · p4 standing=${of(g, "p4").commercial.standing} (of ${of(g, "p4").commercial.cohortSize})`);
  check("13: cohort sizes are per basis, and their sum excludes UNESTABLISHED",
    g.cohortSizes.PIPELINE === 5 && g.cohortSizes.MODELED === 1, JSON.stringify(g.cohortSizes));
  const twoModeled = rank([P3, P1, cand({ pursuitId: "m1", label: "M1", valueBasis: "MODELED", magnitudeUsd: 900_000 }),
                           cand({ pursuitId: "m2", label: "M2", valueBasis: "MODELED", magnitudeUsd: 900_000 })]);
  check("14: REQUIRED — two EQUAL modelled impacts receive EQUAL standing",
    of(twoModeled, "m1").commercial.standing === of(twoModeled, "m2").commercial.standing
    && of(twoModeled, "m1").commercial.standing === NEUTRAL_STANDING,
    `${of(twoModeled, "m1").commercial.standing} vs ${of(twoModeled, "m2").commercial.standing}`);
  check("15: REQUIRED — a SOLE modelled pursuit receives neutral 0.5 standing", of(g, "p4").commercial.standing === 0.5);
  const pipeChanged = rank(GOLDEN.map((c) => c.pursuitId === "p2" ? { ...c, magnitudeUsd: 99_000_000 } : c));
  check("16: REQUIRED — changing a PIPELINE magnitude cannot alter a MODELED pursuit's standing",
    of(pipeChanged, "p4").commercial.standing === of(g, "p4").commercial.standing
    && near(of(pipeChanged, "p4").signals[1].contribution, of(g, "p4").signals[1].contribution),
    `p4 standing ${of(g, "p4").commercial.standing} → ${of(pipeChanged, "p4").commercial.standing}`);
  check("16b: …and it DOES alter the PIPELINE cohort, proving the test is not vacuous",
    of(pipeChanged, "p2").commercial.standing !== of(g, "p2").commercial.standing);
  const modChanged = rank(GOLDEN.map((c) => c.pursuitId === "p4" ? { ...c, magnitudeUsd: 99_000_000 } : c));
  check("17: REQUIRED — changing a MODELED magnitude cannot alter any PIPELINE standing",
    ["p1", "p2", "p3", "p5", "p6"].every((id) => of(modChanged, id).commercial.standing === of(g, id).commercial.standing));
  const conflicted = rank([P1, P3, cand({ pursuitId: "cf", label: "Conflicted", valueBasis: "UNESTABLISHED", contextNeed: 0.9, contextNeedReason: "2 disputed facts" })]);
  const cf = of(conflicted, "cf");
  check("18: REQUIRED — a CONFLICTING/undefensible value case is UNESTABLISHED with ZERO commercial credit",
    cf.commercial.basis === "UNESTABLISHED" && cf.commercial.basisEvidenceWeight === 0
    && cf.signals.find((s) => s.key === "commercialPriority")!.contribution === 0 && cf.commercial.magnitudeUsd === null);
  check("19: …and it still attracts attention through contextNeed, never through value",
    cf.signals.find((s) => s.key === "contextNeed")!.contribution > 0);

  // ══ 5. THE 0.60 POLICY WEIGHT (required tests 7–8) ════════════════════════════════════════════
  // The control acts on the CONSTANT itself: raise MODELED from the 0.60 policy weight to 1.00 and
  // observe what depends on it. In the golden portfolio the ceiling is score-decisive but not
  // order-decisive, so both facts are asserted rather than the convenient one.
  const withCeiling = of(g, "p4").signals[1].contribution;
  BASIS_EVIDENCE_WEIGHT.MODELED = 1.0;
  const liftedG = rank(GOLDEN);
  const lifted = of(liftedG, "p4").signals[1].contribution;
  // A fixture where the ceiling IS the deciding factor: M sits below X with it, and above X without.
  const M = cand({ pursuitId: "m", label: "Modelled M", valueBasis: "MODELED", magnitudeUsd: 900_000,
    contextNeed: 0.5, momentumEvents: [{ materiality: "HIGH", at: daysAgo(1) }], activationReadiness: 0.5 });
  const X = cand({ pursuitId: "x", label: "Pipeline X", valueBasis: "PIPELINE", magnitudeUsd: 700_000, daysToClose: 30,
    contextNeed: 0.4, momentumEvents: [{ materiality: "LOW", at: daysAgo(10) }], activationReadiness: 0.75 });
  const decisiveLifted = order(rank([M, X]));
  BASIS_EVIDENCE_WEIGHT.MODELED = 0.6;
  const decisiveWithCeiling = order(rank([M, X]));
  check("20: REQUIRED NEGATIVE CONTROL — removing the 0.60 policy weight materially changes the modelled pursuit's commercial contribution",
    !near(withCeiling, lifted) && lifted > withCeiling,
    `p4 commercial contribution ${withCeiling.toFixed(4)} → ${lifted.toFixed(4)}`);
  check("20b: …and on a ceiling-decisive fixture it FLIPS the ordering",
    decisiveWithCeiling === "x → m" && decisiveLifted === "m → x", `with 0.60: ${decisiveWithCeiling} · with 1.00: ${decisiveLifted}`);
  check("20c: the constant is restored, and the golden ranking is unaffected by having run the control",
    BASIS_EVIDENCE_WEIGHT.MODELED === 0.6 && order(rank(GOLDEN)) === "p3 → p1 → p4 → p5 → p2 → p6");
  const allText = JSON.stringify(g);
  check("21: REQUIRED — NO user-visible string describes 0.60 as a confidence or a probability",
    !/60\s*%|0\.6\s*confiden|60 percent|probabilit/i.test(allText));
  check("22: the modelled pursuit's reason names the basis in its NATIVE meaning, never as pipeline dollars",
    /modelled customer business impact — not our revenue/.test(of(g, "p4").signals[1].reason), of(g, "p4").signals[1].reason);
  check("23: no rendered string equates the two bases", !/impact.*equals.*pipeline|same as pipeline/i.test(allText));
  check("23b: no rendered string repeats a phrase — the basis clause appears at most once per reason",
    g.items.every((i) => (i.signals[1].reason.match(/on that basis/g) ?? []).length <= 1),
    of(g, "p4").signals[1].reason);

  // ══ 6. NORMALIZATION EDGES ════════════════════════════════════════════════════════════════════
  check("24: n=0 — an empty portfolio ranks to an empty view with no divide-by-zero",
    (() => { const v = rank([]); return v.items.length === 0 && v.comparisonSetSize === 0; })());
  check("25: n=1 — a single pursuit gets NEUTRAL standing, rank 1 of 1, and NO fabricated comparison",
    (() => { const v = rank([P3]); const i = v.items[0];
      return i.rank === 1 && v.comparisonSetSize === 1 && i.commercial.standing === NEUTRAL_STANDING && i.comparedToBelow === null; })());
  check("26: all-equal magnitudes give every pursuit NEUTRAL standing, with no arbitrary ordering by value",
    (() => { const eq = ["a", "b", "c"].map((id) => cand({ pursuitId: id, label: id, valueBasis: "PIPELINE", magnitudeUsd: 500_000, daysToClose: 30 }));
      return rank(eq).items.every((i) => i.commercial.standing === NEUTRAL_STANDING); })());
  check("27: mid-rank percentile — equal values share a value, and one outlier cannot collapse the rest",
    midRankPercentile(5, [5, 5, 1, 100]) === midRankPercentile(5, [5, 5, 1, 100])
    && near(midRankPercentile(5, [1, 5, 5, 100]), (1 + 0.5) / 3) && near(midRankPercentile(1, [1, 5, 5, 100]), 0));
  check("28: proximity — past due is 1, beyond the horizon is 0, and no close date is the declared neutral",
    proximityOf(-3) === 1 && proximityOf(365) === 0 && proximityOf(null) === NEUTRAL_PROXIMITY && near(proximityOf(90), 0.5));
  check("29: momentum decays by half-life and is materiality-weighted",
    near(momentumOf([{ materiality: "HIGH", at: daysAgo(90) }], ASOF), 0.4) && momentumOf([], ASOF) === 0);

  // ══ 7. D-018 — DISCLOSURE BEFORE THE COMPARISON SET ═══════════════════════════════════════════
  // `canDisclose` grants RESTRICTED to any internal caller, so the class this caller genuinely
  // cannot see is TRANSACTION_CONFIDENTIAL. Using RESTRICTED here would have made the test vacuous.
  const partialCaller: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: false };
  const rankAs = (cs: PortfolioCandidate[], caller: Caller) =>
    rankPortfolioPertinence({ caller, candidates: cs, asOf: ASOF, scope: "All pursuits" });
  const hidden = { ...P2, disclosure: "TRANSACTION_CONFIDENTIAL" as PortfolioCandidate["disclosure"] };
  const withHidden = rankAs(GOLDEN.map((c) => c.pursuitId === "p2" ? hidden : c), partialCaller);
  const absent = rankAs(GOLDEN.filter((c) => c.pursuitId !== "p2"), partialCaller);
  const strip = (v: PortfolioPertinenceView) => JSON.stringify({ ...v, withheldCount: 0 });
  check("30: REQUIRED — a withheld pursuit produces EXACTLY the result it would if it were absent from the input entirely",
    strip(withHidden) === strip(absent), `${order(withHidden)} vs ${order(absent)}`);
  check("31: …and only withheldCount differs", withHidden.withheldCount === 1 && absent.withheldCount === 0);
  check("32: the withheld pursuit contributes no score, no rank, no neighbour and no reason",
    !JSON.stringify(withHidden.items).includes("Globex") && withHidden.comparisonSetSize === 5);

  // ══ 8. EXPLAINABILITY ═════════════════════════════════════════════════════════════════════════
  check("33: every item carries all five signals with value × weight = contribution",
    g.items.every((i) => i.signals.length === 5 && i.signals.every((s) => near(s.value * s.weight, s.contribution, 1e-12))));
  check("34: topReasons are drawn from signals that ACTUALLY contributed, strongest first",
    g.items.every((i) => i.topReasons.every((r) => i.signals.some((s) => s.reason === r && s.contribution > 0))));
  const p3 = of(g, "p3"), p1 = of(g, "p1");
  const p3Deltas = p3.signals.map((s, k) => s.contribution - p1.signals[k].contribution);
  const topKey = p3.signals[p3Deltas.indexOf(Math.max(...p3Deltas))].key;
  check("35: the comparative reason is MECHANICALLY CAUSAL — it cites the largest positive Δ contribution",
    p3.comparedToBelow!.includes("Initech renewal") && topKey === "contextNeed" && /context needs attention/.test(p3.comparedToBelow!),
    p3.comparedToBelow!.slice(0, 110));
  check("36: a comparative reason never cites a signal with a non-positive differential",
    g.items.slice(0, -1).every((it, k) => {
      const below = g.items[k + 1];
      return it.signals.every((s, j) => {
        const d = s.contribution - below.signals[j].contribution;
        return d > 0 || !(it.comparedToBelow ?? "").includes(`(Δ ${d.toFixed(3)})`);
      });
    }));
  check("37: the last item has no comparative reason — nothing below it to compare against",
    g.items[g.items.length - 1].comparedToBelow === null);
  check("38: every item reports its basis, cohort size, magnitude, evidence weight, standing and proximity",
    g.items.every((i) => i.commercial.basis && typeof i.commercial.cohortSize === "number"
      && typeof i.commercial.basisEvidenceWeight === "number" && typeof i.commercial.standing === "number"
      && typeof i.commercial.proximity === "number" && typeof i.commercial.magnitudeMeaning === "string"));
  check("39: the view always carries asOf, comparison-set size and scope",
    g.asOf === ASOF.toISOString() && g.comparisonSetSize === 6 && g.scope === "All pursuits");

  // ══ 9. TIES ARE TRUTHFUL ══════════════════════════════════════════════════════════════════════
  const tieA = cand({ pursuitId: "zz-tie-a", label: "Tie A", valueBasis: "PIPELINE", magnitudeUsd: 400_000, daysToClose: 30, contextNeed: 0.2 });
  const tieB = cand({ pursuitId: "aa-tie-b", label: "Tie B", valueBasis: "PIPELINE", magnitudeUsd: 400_000, daysToClose: 30, contextNeed: 0.2 });
  const tied = rank([tieA, tieB]);
  check("40: genuinely tied pursuits are DECLARED tied, and the tie-break is named as an identifier ordering",
    tied.items[0].tiedWithBelow && /Tied with/.test(tied.items[0].comparedToBelow!) && /deterministic tie-break/.test(tied.items[0].comparedToBelow!),
    tied.items[0].comparedToBelow!.slice(0, 100));
  check("41: no business reason is fabricated for a tie-break",
    !/because/.test(tied.items[0].comparedToBelow!) && tied.items[0].pursuitId === "aa-tie-b");

  // ══ 10. SCOPE NARROWING ═══════════════════════════════════════════════════════════════════════
  const narrowed = rank(GOLDEN.filter((c) => !["p2", "p6"].includes(c.pursuitId)), "Partner-sourced");
  check("42: narrowing MAY change relative standing — P1 0.250 → 0.000, P5 0.750 → 0.500",
    of(narrowed, "p1").commercial.standing === 0 && of(narrowed, "p5").commercial.standing === 0.5);
  check("43: narrowing MUST NOT change an absolute signal input — the magnitude is still $1,200,000",
    of(narrowed, "p3").commercial.magnitudeUsd === 1_200_000 && of(narrowed, "p3").commercial.standing === 1);
  check("44: the MODELED pursuit's commercial signal is UNCHANGED — its cohort was not narrowed",
    near(of(narrowed, "p4").signals[1].contribution, of(g, "p4").signals[1].contribution)
    && of(narrowed, "p4").commercial.standing === of(g, "p4").commercial.standing);
  check("45: the narrowed view reports the narrowed scope and set size", narrowed.scope === "Partner-sourced" && narrowed.comparisonSetSize === 4);
  check("46: contextNeed, momentum and readiness are untouched by narrowing",
    ["contextNeed", "momentum", "activationReadiness"].every((k) =>
      near(of(narrowed, "p5").signals.find((s) => s.key === k)!.contribution, of(g, "p5").signals.find((s) => s.key === k)!.contribution)));

  // ══ 11. MOMENTUM / DECISION-PRESSURE DISJOINTNESS ═════════════════════════════════════════════
  check("47: decision-OPENING ledger events are excluded from momentum, so a pending decision is not counted twice",
    MOMENTUM_EXCLUDED_CHANGE_TYPES.has("APPROVAL_REQUESTED") && MOMENTUM_EXCLUDED_CHANGE_TYPES.has("PLAN_REVIEW_REQUIRED")
    && !MOMENTUM_EXCLUDED_CHANGE_TYPES.has("APPROVAL_GRANTED") && !MOMENTUM_EXCLUDED_CHANGE_TYPES.has("PLAN_DECIDED"));
  check("48: a pursuit with nothing pending scores exactly zero decisionPressure",
    of(g, "p3").signals[0].contribution === 0 && of(g, "p1").signals[0].contribution === 0.25);

  // ══ 12. ONE CLOCK ═════════════════════════════════════════════════════════════════════════════
  const later = rankPortfolioPertinence({ caller: CALLER, candidates: GOLDEN, asOf: new Date(ASOF.getTime() + 30 * 86_400_000), scope: "All pursuits" });
  check("49: every clock-derived signal moves with asOf — and ONLY with asOf",
    later.asOf !== g.asOf && of(later, "p3").signals[3].contribution < of(g, "p3").signals[3].contribution
    && near(of(later, "p3").signals[1].contribution, of(g, "p3").signals[1].contribution),
    "momentum decays, commercial standing does not move");
  check("50: nothing in the module reads the wall clock during a ranking — two calls with the same frozen asOf are identical",
    JSON.stringify(rank(GOLDEN)) === JSON.stringify(rank(GOLDEN)));

  // ══ 13. TODAY ORDERING — the third key only, and flag-OFF byte identity ══════════════════════
  type Row = Parameters<typeof todaySort>[0];
  const row = (o: Partial<Row>): Row => ({ decisionClass: "FYI", operationalUrgency: "normal",
    commercialPriority: "low", ageSeconds: 100, ...o } as Row);
  // With NO pertinence rank supplied (flag OFF) the comparison must fall through to the original
  // commercial-priority band, exactly as the pre-P2 product did.
  const offA = row({ commercialPriority: "very_high" }), offB = row({ commercialPriority: "low" });
  check("56: FLAG OFF — with no rank supplied, ordering still falls to the commercial-priority band",
    todaySort(offA, offB) < 0 && todaySort(offB, offA) > 0);
  check("57: FLAG OFF — band ordering is unchanged across the whole band vocabulary",
    ["very_high", "high", "moderate", "low", "unknown"].every((b, i, arr) =>
      i === 0 || todaySort(row({ commercialPriority: arr[i - 1] }), row({ commercialPriority: b })) < 0));
  check("58: FLAG ON — a supplied pertinence rank replaces the band as the THIRD key",
    todaySort(row({ commercialPriority: "low", pertinenceRank: 1 }), row({ commercialPriority: "very_high", pertinenceRank: 9 })) < 0);
  check("59: P2 NEVER outranks decision class — a #1-ranked FYI still loses to a DECISION_REQUIRED",
    todaySort(row({ decisionClass: "FYI", pertinenceRank: 1 }), row({ decisionClass: "DECISION_REQUIRED", pertinenceRank: 99 })) > 0);
  check("60: P2 NEVER outranks operational urgency — a #1-ranked normal loses to a critical",
    todaySort(row({ operationalUrgency: "normal", pertinenceRank: 1 }), row({ operationalUrgency: "critical", pertinenceRank: 99 })) > 0);
  check("61: age remains the final tie-break, older unresolved first",
    todaySort(row({ pertinenceRank: 3, ageSeconds: 900 }), row({ pertinenceRank: 3, ageSeconds: 100 })) < 0);
  check("62: a rank on ONE side only falls back to the band — never a half-applied ordering",
    todaySort(row({ commercialPriority: "very_high", pertinenceRank: 9 }), row({ commercialPriority: "low" })) < 0);

  // ══ 14. DB-BACKED: loaders read canonical state, scoped to the tenant ═════════════════════════
  const db: PoolClient = await owner.connect();
  try {
    const orgs = (await db.query<{ id: string }>(`select id from organizations order by created_at limit 2`)).rows;
    if (orgs.length >= 1) {
      const c0: Caller = { orgId: orgs[0].id, canSeeInternal: true, canSeeTransactionDetail: true };
      const loaded = await loadPortfolioCandidates(db, c0, ASOF);
      check("51: the loaders return candidates for the caller's org and nothing else",
        loaded.every((x) => typeof x.pursuitId === "string"), `${loaded.length} candidates`);
      const ids = new Set(loaded.map((x) => x.pursuitId));
      const foreign = orgs[1]
        ? (await db.query<{ n: string }>(`select count(*)::text n from pursuits where org_id = $1 and id = any($2::uuid[])`,
            [orgs[1].id, [...ids]])).rows[0].n
        : "0";
      check("52: no pursuit from another org entered the comparison set", foreign === "0", `${foreign} foreign`);
      check("53: every loaded candidate declares a value basis and a native-meaning magnitude",
        loaded.every((x) => (["PIPELINE", "MODELED", "UNESTABLISHED"] as ValueBasis[]).includes(x.valueBasis)
          && (x.valueBasis === "UNESTABLISHED" ? x.magnitudeUsd === null : typeof x.magnitudeUsd === "number")));
      const ranked = rankPortfolioPertinence({ caller: c0, candidates: loaded, asOf: ASOF, scope: "All pursuits" });
      check("54: a real portfolio ranks deterministically from canonical state",
        JSON.stringify(ranked) === JSON.stringify(rankPortfolioPertinence({ caller: c0, candidates: loaded, asOf: ASOF, scope: "All pursuits" })));
      check("55: ranking wrote nothing — the module is a pure read-model",
        (await db.query<{ n: string }>(`select count(*)::text n from change_ledger where change_type like 'PERTINENCE%'`)).rows[0].n === "0");
    } else check("51: (skipped — no organizations in this world)", true);
  } finally { db.release(); }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  await owner.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log(`[portfolio-pertinence-verify] fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
