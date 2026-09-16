import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { resolveCompanyIdentity } from "../src/lib/identity/lookup";
import { decideToolScope } from "../src/lib/agents/ask-scope";
import { loadDrivers } from "../src/lib/value/drivers";
import { getExecutionEvidence } from "../src/lib/partners/intelligence";
import { eventsForAccount, loadLifecycleFacts, primaryLifecycleOutcome, LIFECYCLE_STATE_RANK } from "../src/lib/lifecycle/state";

/**
 * SEMANTIC determinism (D-G8-4). The sibling suite `persisted-determinism` proves results are
 * STABLE; this one proves they are RIGHT. A repeatable answer that no product rule justifies is
 * exactly what D-G8-4 exists to remove, so every assertion below is about MEANING:
 *
 *   4A  provenance precedence on an exact confidence+recency tie (PROVENANCE_STRENGTH, canonical),
 *       and UNRESOLVED where the table genuinely does not order the pair
 *   4B  a median over the WHOLE eligible population, and a categorical mode that is never a median
 *   4C  identity from identity evidence — never name length, alphabet, uuid or row order — with
 *       ambiguity failing closed at the scope boundary, and in-force facts judged against an
 *       explicit asOf
 *   4D  a campaign seed that is chosen deliberately or not at all
 *
 * SAFETY. Fixtures COMMIT, so this runs only on a disposable seeded clone (SEEDED_CLONE).
 *
 *   npx tsx scripts/verify-run.ts --suite semantic-determinism
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const owner = new Pool({ connectionString: CONN, max: 2 });
let passed = 0, failed = 0;
const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};

const T0 = new Date("2026-01-01T00:00:00Z");
let ORG = "";

async function company(db: PoolClient, name: string, normalized?: string): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into companies (id, legal_name, normalized_name) values ($1,$2,$3)`,
    [id, name, normalized ?? name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()]);
  return id;
}

/** Plant one economic fact. `confidence`/`provenance` drive 4A; the window drives the asOf rule. */
async function fact(db: PoolClient, o: {
  companyId: string; predicate: string; provenance: string; confidence: number;
  observedLast: Date; low: number; high: number; validFrom?: Date | null; validUntil?: Date | null;
  status?: string; supersededBy?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into facts (id, org_id, company_id, subject_label, predicate_key, object_type, object_value,
                        origin_kind, provenance_class, status, confidence, as_of, observed_at,
                        observed_first_at, observed_last_at, valid_from, valid_until, superseded_by,
                        fact_identity_key, fact_value_key, disclosure_class)
     values ($1,$2,$3,'probe',$4,'RANGE',$5,'HUMAN',$6,$7,$8,$9,$9,$9,$9,$10,$11,$12,$13,$14,'INTERNAL')`,
    [id, ORG, o.companyId, o.predicate, JSON.stringify({ low: o.low, high: o.high }), o.provenance,
     o.status ?? "CURRENT", o.confidence, o.observedLast, o.validFrom ?? null, o.validUntil ?? null,
     o.supersededBy ?? null, `${id}-ik`, `${id}-vk`]);
  return id;
}

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[semantic-determinism-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const db = await owner.connect();
  ORG = (await db.query<{ id: string }>(`select id from organizations where name = 'Vertex Systems'`)).rows[0].id;

  // ══ 4C — ENTITY RESOLUTION ══════════════════════════════════════════════════════════════════
  console.log("\nD-G8-4C — entity resolution");
  // "Zeta" is SHORTER and sorts FIRST; "Alpha Zeta Industries" is the exact normalized answer.
  const shortCo = await company(db, "Zeta", "zeta");
  const exactCo = await company(db, "Alpha Zeta Industries", "alpha zeta industries");
  const r1 = await resolveCompanyIdentity(db, "Alpha Zeta Industries");
  check("4C: exact normalized name wins over a SHORTER, alphabetically-earlier candidate",
    r1.kind === "RESOLVED" && r1.companyId === exactCo && r1.via === "NORMALIZED_NAME", JSON.stringify(r1));

  const byId = await resolveCompanyIdentity(db, exactCo);
  check("4C: an explicit canonical id resolves as CANONICAL_ID",
    byId.kind === "RESOLVED" && byId.companyId === exactCo && byId.via === "CANONICAL_ID", JSON.stringify(byId));

  // An ID-type alias on one company vs a name alias on another, for the same typed string.
  const idAliasCo = await company(db, "Northwind Holdings");
  const nameAliasCo = await company(db, "Southwind Group");
  await db.query(`insert into company_aliases (company_id, alias, alias_type) values ($1,'ACCT-7781','crm_account_id')`, [idAliasCo]);
  await db.query(`insert into company_aliases (company_id, alias, alias_type) values ($1,'ACCT-7781','name')`, [nameAliasCo]);
  const rAlias = await resolveCompanyIdentity(db, "ACCT-7781");
  check("4C: an exact ID-type alias beats a name alias on a different company",
    rAlias.kind === "RESOLVED" && rAlias.companyId === idAliasCo && rAlias.via === "ID_ALIAS", JSON.stringify(rAlias));

  // Two ID-type aliases, two companies, no namespace supplied → unresolved, not a pick.
  const rivalCo = await company(db, "Eastwind Ltd");
  await db.query(`insert into company_aliases (company_id, alias, alias_type) values ($1,'ACCT-7781','vendor_account_id')`, [rivalCo]);
  const rConflict = await resolveCompanyIdentity(db, "ACCT-7781");
  check("4C: two conflicting ID-type aliases resolve to UNRESOLVED",
    rConflict.kind === "AMBIGUOUS" && rConflict.via === "ID_ALIAS", JSON.stringify(rConflict));
  const rNs = await resolveCompanyIdentity(db, "ACCT-7781", { aliasType: "crm_account_id" });
  check("4C: an explicitly supplied namespace resolves within that namespace",
    rNs.kind === "RESOLVED" && rNs.companyId === idAliasCo, JSON.stringify(rNs));

  // Fuzzy: one candidate resolves, two do not.
  const fuzz1 = await company(db, "Helios Manufacturing Group");
  // "Helios Manufacturing Group" normalizes to "helios manufacturing" (trailing legal suffix), so the
  // typed name is an exact NORMALIZED match — rung 4, ahead of fuzzy. This is the corrected ladder.
  const rFuzz = await resolveCompanyIdentity(db, "Helios Manufacturing");
  check("4C: an exact normalized canonical match resolves at rung 4, ahead of fuzzy",
    rFuzz.kind === "RESOLVED" && rFuzz.companyId === fuzz1 && rFuzz.via === "NORMALIZED_NAME", JSON.stringify(rFuzz));
  const fuzz2 = await company(db, "Helios Manufacturing Partners");
  const rStill = await resolveCompanyIdentity(db, "Helios Manufacturing");
  check("4C: adding a longer fuzzy sibling does NOT make the normalized-exact match ambiguous",
    rStill.kind === "RESOLVED" && rStill.companyId === fuzz1 && rStill.via === "NORMALIZED_NAME", JSON.stringify(rStill));
  // A typed value with ZERO normalized-exact matches and two fuzzy candidates stays unresolved.
  const rFuzz2 = await resolveCompanyIdentity(db, "Helios Manufact");
  check("4C: TWO fuzzy candidates resolve to UNRESOLVED, never the shorter/first one",
    rFuzz2.kind === "AMBIGUOUS" && rFuzz2.via === "UNIQUE_FUZZY" && rFuzz2.candidates === 2, JSON.stringify(rFuzz2));

  // ── rung 4: exact normalized canonical match (D-G8-4C correction) ───────────────────────────
  // The hosted defect, as a regression: the exact legal name used to reach the fuzzy rung and come
  // back AMBIGUOUS because a longer sibling also matched the substring.
  // The canonical world already carries the exact hosted fixture — "Initech Financial" and
  // "Initech Financial (expansion)", with normalized_name stored RAW. Resolve against those rather
  // than planting duplicates, so this is the hosted defect itself, reproduced.
  const initech = (await db.query<{ id: string }>(`select id from companies where legal_name = 'Initech Financial'`)).rows[0].id;
  const initechX = (await db.query<{ id: string }>(`select id from companies where legal_name = 'Initech Financial (expansion)'`)).rows[0].id;
  const rIni = await resolveCompanyIdentity(db, "Initech Financial");
  check("4C rung 4: the exact name resolves via NORMALIZED_NAME even though a longer sibling fuzzy-matches",
    rIni.kind === "RESOLVED" && rIni.companyId === initech && rIni.via === "NORMALIZED_NAME", JSON.stringify(rIni));
  const fuzzyN = (await db.query<{ n: string }>(
    `select count(*)::text n from companies where legal_name ilike $1`, ["%Initech Financial%"])).rows[0].n;
  check("4C rung 4: and the fuzzy rung alone would have been ambiguous (the defect reproduction)",
    Number(fuzzyN) >= 2, `${fuzzyN} fuzzy candidates`);
  check("4C rung 4: it does NOT rely on companies.normalized_name (stored raw here, as on hosted)",
    (await db.query<{ n: string }>(`select count(*)::text n from companies where id = $1 and normalized_name = 'initech financial'`, [initech])).rows[0].n === "0");

  // Suffix-stripped canonical names resolve at rung 4 too.
  const globexCo = await company(db, "Globex Worldwide Inc.", "Globex Worldwide Inc.");
  const rGlobex = await resolveCompanyIdentity(db, "Globex Worldwide Inc.");
  check("4C rung 4: a suffixed canonical name ('Inc.') resolves via NORMALIZED_NAME",
    rGlobex.kind === "RESOLVED" && rGlobex.companyId === globexCo && rGlobex.via === "NORMALIZED_NAME", JSON.stringify(rGlobex));
  const starkCo = await company(db, "Stark Dynamics LLC", "Stark Dynamics LLC");
  const rStark = await resolveCompanyIdentity(db, "Stark Dynamics LLC");
  check("4C rung 4: an 'LLC' canonical name resolves via NORMALIZED_NAME",
    rStark.kind === "RESOLVED" && rStark.companyId === starkCo && rStark.via === "NORMALIZED_NAME", JSON.stringify(rStark));

  // Two canonical names that normalize to the SAME value are genuinely indistinguishable.
  await company(db, "Quasar Dynamics Inc", "Quasar Dynamics Inc");
  await company(db, "Quasar Dynamics LLC", "Quasar Dynamics LLC");
  const rQuasar = await resolveCompanyIdentity(db, "Quasar Dynamics");
  check("4C rung 4: two canonical names normalizing to the same value are AMBIGUOUS, never picked",
    rQuasar.kind === "AMBIGUOUS" && rQuasar.via === "NORMALIZED_NAME" && rQuasar.candidates === 2, JSON.stringify(rQuasar));

  // An alphabetically-EARLIER company that also fuzzy-matches must not win.
  await company(db, "Aaa Initech Financial Co", "Aaa Initech Financial Co");
  const rIni2 = await resolveCompanyIdentity(db, "Initech Financial");
  check("4C rung 4: an alphabetically-earlier fuzzy-matching decoy does not change the resolution",
    rIni2.kind === "RESOLVED" && rIni2.companyId === initech, JSON.stringify(rIni2));

  // uuid order and heap order are irrelevant to a normalized-exact match.
  const uuidOutcomes = new Set<string>();
  for (const _ of [0, 1]) {
    await db.query(`update companies set legal_name = legal_name where id = any($1)`, [[initech, initechX]]);
    uuidOutcomes.add(JSON.stringify(await resolveCompanyIdentity(db, "Initech Financial")));
  }
  check("4C rung 4: heap/tuple rewrites cannot change a normalized-exact resolution", uuidOutcomes.size === 1);
  const lowId = "00000000-0000-4000-8000-0000000000aa";
  await db.query(`insert into companies (id, legal_name, normalized_name) values ($1,'Initech Financial Overseas','Initech Financial Overseas')`, [lowId]);
  const rIni3 = await resolveCompanyIdentity(db, "Initech Financial");
  check("4C rung 4: a lower-uuid fuzzy-matching decoy does not change the resolution",
    rIni3.kind === "RESOLVED" && rIni3.companyId === initech, JSON.stringify(rIni3));

  // Zero normalized-exact matches still proceeds to the unique fuzzy rung.
  const only = await company(db, "Peregrine Instruments Worldwide", "Peregrine Instruments Worldwide");
  const rFall = await resolveCompanyIdentity(db, "Peregrine Instruments W");
  check("4C: zero normalized-exact matches falls through to UNIQUE_FUZZY",
    rFall.kind === "RESOLVED" && rFall.companyId === only && rFall.via === "UNIQUE_FUZZY", JSON.stringify(rFall));

  // Negative controls: none of the forbidden signals can change the answer.
  const permutations = [[fuzz1, fuzz2], [fuzz2, fuzz1]];
  const outcomes = new Set<string>();
  for (const order of permutations) {
    await db.query(`update companies set legal_name = legal_name where id = any($1)`, [order]);  // rewrite heap order
    outcomes.add(JSON.stringify(await resolveCompanyIdentity(db, "Helios Manufacturing")));
  }
  check("4C: insertion/heap order cannot change identity", outcomes.size === 1, `${outcomes.size} distinct`);

  // ══ ask-scope: ambiguity fails CLOSED and is its own outcome ════════════════════════════════
  console.log("\nD-G8-4C — ask-scope security");
  const tool = { name: "account_brief" } as Parameters<typeof decideToolScope>[2];
  const scopeIds = [fuzz1, fuzz2];
  const amb = await decideToolScope(db, ORG, tool, { account: "Helios Manufact" }, scopeIds);
  check("ask-scope: an AMBIGUOUS account blocks execution (allowed = false)", amb.allowed === false);
  check("ask-scope: ambiguity is reported as its own outcome, not as out-of-scope",
    amb.ambiguous?.ambiguous_account === true && amb.refusal === undefined, JSON.stringify(amb.ambiguous ?? amb.refusal));
  const leak = JSON.stringify(amb.ambiguous ?? {});
  check("ask-scope: the ambiguity explanation leaks no candidate names or ids",
    !leak.includes("Helios Manufacturing Group") && !leak.includes("Helios Manufacturing Partners")
    && !leak.includes(fuzz1) && !leak.includes(fuzz2), leak);
  const uniq = await decideToolScope(db, ORG, tool, { account: "Northwind Holdings" }, [idAliasCo]);
  check("ask-scope: an unambiguous in-scope account is still allowed", uniq.allowed === true);

  // ══ 4C — IN-FORCE FACTS, explicit asOf ══════════════════════════════════════════════════════
  console.log("\nD-G8-4C — in-force facts");
  const fco = await company(db, "Validity Probe Co");
  const AS_OF = new Date("2026-06-01T00:00:00Z");
  await fact(db, { companyId: fco, predicate: "infrastructure_cost", provenance: "INFERRED", confidence: 0.9,
    observedLast: T0, low: 100, high: 100, validUntil: new Date("2026-03-01T00:00:00Z") });   // expired
  const drivers1 = await loadDrivers(db, ORG, fco, AS_OF);
  check("4C facts: a fact whose valid_until has passed is NOT in force at asOf",
    drivers1.every((d) => d.value == null), JSON.stringify(drivers1.map((d) => d.value)));
  const past = await loadDrivers(db, ORG, fco, new Date("2026-02-01T00:00:00Z"));
  check("4C facts: the SAME fact IS in force at an earlier asOf (historical evaluation works)",
    past.some((d) => d.value != null), JSON.stringify(past.map((d) => d.value?.low)));

  const fco2 = await company(db, "Future Window Co");
  await fact(db, { companyId: fco2, predicate: "infrastructure_cost", provenance: "INFERRED", confidence: 0.9,
    observedLast: T0, low: 200, high: 200, validFrom: new Date("2026-09-01T00:00:00Z") });     // not yet valid
  check("4C facts: a fact whose valid_from is in the future is NOT in force at asOf",
    (await loadDrivers(db, ORG, fco2, AS_OF)).every((d) => d.value == null));

  const fco3 = await company(db, "Conflict Co");
  await fact(db, { companyId: fco3, predicate: "infrastructure_cost", provenance: "INFERRED", confidence: 0.9, observedLast: T0, low: 10, high: 10 });
  await fact(db, { companyId: fco3, predicate: "infrastructure_cost", provenance: "INFERRED", confidence: 0.9, observedLast: T0, low: 99, high: 99 });
  const conflicted = await loadDrivers(db, ORG, fco3, AS_OF);
  check("4C facts: two live facts with DIFFERENT values stay UNRESOLVED (conflicting), never ranked",
    conflicted.every((d) => d.value == null && d.conflicting), JSON.stringify(conflicted.map((d) => d.conflicting)));

  // ══ 4A — PROVENANCE PRECEDENCE ══════════════════════════════════════════════════════════════
  console.log("\nD-G8-4A — provenance precedence");
  const { PROVENANCE_STRENGTH } = await import("../src/lib/pursuits/read-models/context-health");
  const S = PROVENANCE_STRENGTH as Record<string, number>;
  check("4A: CUSTOMER_DECLARED outranks THIRD_PARTY_VERIFIED (the binding ruling)",
    S.CUSTOMER_DECLARED > S.THIRD_PARTY_VERIFIED, `${S.CUSTOMER_DECLARED} > ${S.THIRD_PARTY_VERIFIED}`);
  check("4A: THIRD_PARTY_UNVERIFIED outranks INFERRED (the binding ruling)",
    S.THIRD_PARTY_UNVERIFIED > S.INFERRED, `${S.THIRD_PARTY_UNVERIFIED} > ${S.INFERRED}`);
  check("4A: FIRST_PARTY is the strongest", Object.values(S).every((v) => v <= S.FIRST_PARTY));
  check("4A: HUMAN_ASSERTED and SECOND_PARTY are EQUAL — deliberately not ordered",
    S.HUMAN_ASSERTED === S.SECOND_PARTY, `${S.HUMAN_ASSERTED} = ${S.SECOND_PARTY}`);

  const { resolveTie, compareProvenance } = await import("../src/lib/facts/provenance-precedence");
  const mk = (cls: string, conf: number, t: number) => ({ provenanceClass: cls, confidence: conf, observedLastAt: new Date(t) });
  const cmp = (a: ReturnType<typeof mk>, b: ReturnType<typeof mk>) =>
    b.confidence - a.confidence || b.observedLastAt.getTime() - a.observedLastAt.getTime()
    || compareProvenance(a.provenanceClass, b.provenanceClass);
  const same = (a: ReturnType<typeof mk>, b: ReturnType<typeof mk>) => a.provenanceClass === b.provenanceClass;

  const hi = resolveTie([mk("INFERRED", 0.9, 1), mk("FIRST_PARTY", 0.4, 1)], cmp, same);
  check("4A: higher confidence beats stronger provenance (confidence stays primary)",
    hi.kind === "RESOLVED" && hi.value.provenanceClass === "INFERRED");
  const rec = resolveTie([mk("FIRST_PARTY", 0.5, 1), mk("INFERRED", 0.5, 2)], cmp, same);
  check("4A: on a confidence tie, the NEWER observation wins (recency stays secondary)",
    rec.kind === "RESOLVED" && rec.value.provenanceClass === "INFERRED");
  const prov = resolveTie([mk("THIRD_PARTY_VERIFIED", 0.5, 1), mk("CUSTOMER_DECLARED", 0.5, 1)], cmp, same);
  check("4A: on confidence+recency tie, CUSTOMER_DECLARED beats THIRD_PARTY_VERIFIED",
    prov.kind === "RESOLVED" && prov.value.provenanceClass === "CUSTOMER_DECLARED");
  const unres = resolveTie([mk("HUMAN_ASSERTED", 0.5, 1), mk("SECOND_PARTY", 0.5, 1)], cmp, same);
  check("4A: HUMAN_ASSERTED vs SECOND_PARTY with DIFFERENT output returns UNRESOLVED",
    unres.kind === "UNRESOLVED" && unres.tied.length === 2, unres.kind);
  const equiv = resolveTie([mk("SECOND_PARTY", 0.5, 1), mk("SECOND_PARTY", 0.5, 1)], cmp, same);
  check("4A: equivalent tied facts collapse — no fabricated disagreement", equiv.kind === "RESOLVED");

  // ══ plan-loaders / lifecycle state rank ═════════════════════════════════════════════════════
  console.log("\nD-G8-4C — plan-loaders / lifecycle rank");
  check("plan-loaders: VERIFIED_DATE outranks INFERRED_WINDOW in the existing state rank",
    LIFECYCLE_STATE_RANK.VERIFIED_DATE < LIFECYCLE_STATE_RANK.INFERRED_WINDOW,
    `${LIFECYCLE_STATE_RANK.VERIFIED_DATE} < ${LIFECYCLE_STATE_RANK.INFERRED_WINDOW}`);

  // ══ 4B — OUTCOME SUMMARY ════════════════════════════════════════════════════════════════════
  console.log("\nD-G8-4B — outcome summary");
  const partner = (await db.query<{ id: string }>(`select id from partners where org_id = $1 order by created_at, id limit 1`, [ORG])).rows[0].id;
  const pco = await company(db, "Outcome Probe Co");
  const days = [1, 3, 5, 100];          // median of the WHOLE set = 4
  const labels = ["CLOSED_WON", "CLOSED_WON", "CLOSED_LOST", "NO_DECISION"];
  for (const [i, d] of days.entries()) {
    const pid = randomUUID();
    await db.query(`insert into pursuits (id, org_id, account_id, dedup_key, selected_partner_id)
                    values ($1,$2,$3,$4,$5)`, [pid, ORG, pco, `probe-${i}-${pid}`, partner]);
    await db.query(`insert into pursuit_outcomes (org_id, pursuit_id, company_id, outcome_label, is_terminal, seconds_since_recommended)
                    values ($1,$2,$3,$4,true,$5)`, [ORG, pid, pco, labels[i], d * 86400]);
  }
  const ev = await getExecutionEvidence(db, ORG, partner, null);
  check("4B: the median is over the WHOLE eligible terminal population, not one category",
    ev.medianDaysToOutcome === 4, `median=${ev.medianDaysToOutcome} (expected 4 from ${JSON.stringify(days)})`);
  check("4B: the most common outcome is the true mode with count and share",
    ev.mostCommonOutcome === "CLOSED_WON" && ev.mostCommonOutcomeCount === 2
    && Math.abs((ev.mostCommonOutcomeShare ?? 0) - 0.5) < 1e-9,
    `${ev.mostCommonOutcome} ${ev.mostCommonOutcomeCount}/${ev.sample}`);
  check("4B: no line labels a categorical value as a median",
    ev.lines.every((l) => !/median/i.test(l.text) || /^Median \d+d/.test(l.text)),
    JSON.stringify(ev.lines.map((l) => l.text)));
  // Force a modal tie.
  const pidT = randomUUID();
  await db.query(`insert into pursuits (id, org_id, account_id, dedup_key, selected_partner_id) values ($1,$2,$3,$4,$5)`, [pidT, ORG, pco, `probe-tie-${pidT}`, partner]);
  await db.query(`insert into pursuit_outcomes (org_id, pursuit_id, company_id, outcome_label, is_terminal, seconds_since_recommended)
                  values ($1,$2,$3,'CLOSED_LOST',true,$4)`, [ORG, pidT, pco, 7 * 86400]);
  const evTie = await getExecutionEvidence(db, ORG, partner, null);
  check("4B: tied modes are SURFACED as a tie, never resolved by query order",
    evTie.mostCommonOutcome === null && evTie.mostCommonOutcomeTied.join("/") === "CLOSED_LOST/CLOSED_WON",
    `tied=${JSON.stringify(evTie.mostCommonOutcomeTied)}`);
  const evNone = await getExecutionEvidence(db, ORG, randomUUID(), null);
  check("4B: no timestamped outcomes → UNKNOWN (null), never zero",
    evNone.medianDaysToOutcome === null && evNone.mostCommonOutcome === null, JSON.stringify(evNone.medianDaysToOutcome));

  // ══ 4D — CAMPAIGN SEED ══════════════════════════════════════════════════════════════════════
  console.log("\nD-G8-4D — campaign seed");
  const { createMultiVendorCampaign } = await import("../src/lib/campaigns/multi-vendor");
  const partners2 = (await db.query<{ id: string }>(`select id from partners where org_id = $1 order by created_at, id limit 2`, [ORG])).rows.map((r) => r.id);
  const node = (await db.query<{ id: string }>(`select id from taxonomy_nodes order by id limit 1`)).rows[0].id;
  const sv = (await db.query<{ id: string }>(`select id from score_versions order by id limit 1`)).rows[0]?.id ?? null;
  const mkPlay = async (name: string, ids: string[], seed?: string) => {
    const { campaignId } = await createMultiVendorCampaign(db, {
      orgId: ORG, name, companyIds: ids,
      partners: partners2.map((id, i) => ({ id, role: (i === 0 ? "co_sell" : "fulfillment") as never })),
      seedCompanyId: seed ?? null,
    });
    return (await db.query<{ company_id: string | null }>(`select company_id from campaigns where id = $1`, [campaignId])).rows[0].company_id;
  };
  const score = async (cid: string, v: number) => {
    if (!sv) return;
    await db.query(`insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id, computed_at)
                    values ($1,$2,$3,$4,'medium',$5,$6)`, [ORG, cid, node, v, sv, T0]);
  };
  const a = await company(db, "Seed Alpha"), b = await company(db, "Seed Beta");
  await score(a, 80); await score(b, 40);
  check("4D: the UNIQUE highest-scoring member becomes the seed", (await mkPlay("uniq", [a, b])) === a);
  check("4D: reversing the input order does not change the seed", (await mkPlay("uniq-rev", [b, a])) === a);
  const c1 = await company(db, "Seed Gamma"), c2 = await company(db, "Seed Delta");
  await score(c1, 70); await score(c2, 70);
  check("4D: a TIE for the top score leaves the seed UNRESOLVED (null)", (await mkPlay("tie", [c1, c2])) === null);
  const u1 = await company(db, "Seed Unscored One"), u2 = await company(db, "Seed Unscored Two");
  check("4D: an entirely unscored population leaves the seed UNRESOLVED (null)", (await mkPlay("unscored", [u1, u2])) === null);
  check("4D: an explicit valid seed wins even against a higher-scoring member",
    (await mkPlay("explicit", [a, b], b)) === b);
  let rejected = false;
  try { await mkPlay("outside", [a, b], c1); } catch { rejected = true; }
  check("4D: an explicit seed OUTSIDE the eligible population is rejected", rejected);
  const unresolvedVisible = (await db.query<{ n: string }>(
    `select count(*)::text n from campaigns ca left join revenue_motions m on m.id = ca.motion_id
      left join companies c on c.id = coalesce(ca.company_id, m.company_id)
      where ca.org_id = $1 and ca.company_id is null`, [ORG])).rows[0].n;
  check("4D: an unresolved-seed campaign still appears through the readers' LEFT JOIN",
    Number(unresolvedVisible) >= 2, `${unresolvedVisible} unresolved campaigns visible`);

  // ══ SEND SAFETY — the same five persisted surfaces every prior gate reports ═════════════════
  console.log("\nSend safety");
  const send = (await db.query<Record<string, number>>(
    `select (select count(*) from messages)::int messages,
            (select count(*) from action_outbox)::int action_outbox,
            (select count(*) from email_events)::int email_events,
            (select count(*) from sending_identities)::int sending_identities,
            (select count(*) from campaign_touches where status = 'sent')::int sent_touches`)).rows[0];
  check("send safety: messages / action_outbox / email_events / sending_identities / sent_touches = 0/0/0/0/0",
    Object.values(send).every((v) => Number(v) === 0), JSON.stringify(send));

  db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error("[semantic-determinism-verify] fatal:", e); process.exitCode = 2; })
  .finally(async () => { await owner.end(); });
