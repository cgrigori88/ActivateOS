/**
 * The verifier environment contract (Wave 6B §8).
 *
 * WHAT WAS WRONG. The battery silently mixed two incompatible database
 * assumptions and named neither of them. Some suites seed their own fixtures,
 * COMMIT them, and use hard-coded values on uniquely-constrained columns — they
 * need a disposable database and are not idempotent. Others read the canonical
 * synthetic demo world and fail on a bare migrated database. Running the whole
 * battery against one database therefore could not be green, ever, and the only
 * symptom anyone saw was a NOT NULL violation on `taxonomy_nodes.slug` — the
 * first constraint the fixtures happened to hit.
 *
 * Worse than the noise: a developer pointing the fresh-database suites at the
 * demo database writes committed fixture rows into the demo world. That is how
 * the stray `Tenant A` orgs and `E3*` taxonomy nodes got into it.
 *
 * This file is the single source of truth for which suite needs what. It is
 * data, not policy — `scripts/verify-run.ts` executes it, and `verify-guard.ts`
 * enforces it at the point of connection.
 */

export type VerifyClass = "FRESH" | "SEEDED" | "EITHER" | "DEPLOYMENT_ONLY";

export interface SuiteSpec {
  /** Script basename without `-verify.ts`. */
  name: string;
  cls: VerifyClass;
  /** Why it is in this class — read by the runner's `--explain`. */
  why: string;
  /**
   * Deployment master switches this suite requires (Wave 6C §3).
   *
   * Feature flags here are TWO-layer — an environment master switch AND a
   * per-org `org_features` row — and they COMPOSE: `outcomeLearning` is
   * `experience && outcome_learning`, and `experience` is
   * `pursuits && facts && routing && pursuit_experience` (tenant-flags.ts:61-64).
   * So a suite exercising the outcome bridge needs FIVE switches, not one.
   *
   * These are declared PER SUITE and never globally, because they are not
   * interchangeable: `routes-verify` asserts that `routingEnabled()` is false
   * by default, so setting ROUTING_ENABLED for everything would break it for
   * a reason that has nothing to do with routing.
   */
  env?: Record<string, string>;
  /**
   * H1A — certification integrity. `SEEDED_CLONE`: the suite needs the canonical world's content
   * but WRITES through real application paths that commit on their own connections. verify-run.ts
   * runs it on a disposable clone of the canonical world (never the world itself), and the suite
   * refuses to run on anything that is not a marked clone (scripts/seeded-clone.ts). Measured, not
   * assumed: each of these moved the whole-world fingerprint when run against the canonical world.
   */
  isolation?: "SEEDED_CLONE";
}

/** The full experience chain plus outcome learning — see SuiteSpec.env. */
const OUTCOME_LEARNING_ENV: Record<string, string> = {
  PURSUITS_ENABLED: "true",
  FACTS_ENABLED: "true",
  ROUTING_ENABLED: "true",
  PURSUIT_EXPERIENCE_ENABLED: "true",
  OUTCOME_LEARNING_ENABLED: "true",
};

export const SUITES: SuiteSpec[] = [
  // ── FRESH: seeds and COMMITS its own fixtures; not idempotent; destructive
  //    if pointed at a persistent world.
  { name: "pursuit", cls: "FRESH", why: "commits two-tenant fixtures; asserts on their exact ids" },
  { name: "routes", cls: "FRESH", why: "commits partner/seller/alias fixtures; entity resolution asserts a unique match" },
  { name: "experience", cls: "FRESH", why: "commits two-tenant fixtures and asserts disclosure over them" },
  { name: "facts", cls: "FRESH", why: "commits evidence/signal fixtures; asserts verification-state transitions" },
  { name: "governance", cls: "FRESH", why: "commits cross-tenant grant fixtures; asserts action authority" },

  // ── SEEDED: reads the canonical synthetic demo world; nothing to read on a
  //    bare migrated database.
  { name: "interpret", cls: "SEEDED", why: "resolves Ask intents against canonical demo accounts" },
  { name: "lifecycle-query", cls: "SEEDED", why: "queries the canonical lifecycle projections; H1A: rewrites canonical facts in place (same count, new content) — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", isolation: "SEEDED_CLONE" },
  { name: "lifecycle-acceptance", cls: "SEEDED", why: "walks the canonical lifecycle acceptance path; H1A: commits attribution, ledger, governed invocations, a new opportunity, stage transitions, outcomes, overrides and team members — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", env: OUTCOME_LEARNING_ENV, isolation: "SEEDED_CLONE" },
  { name: "value-case", cls: "SEEDED", why: "reads canonical value cases and their bands" },
  { name: "stakeholder-intel", cls: "SEEDED", why: "reads canonical stakeholder assertions" },
  { name: "partner-intel", cls: "SEEDED", why: "reads canonical partner activation history; H1A: commits a pursuit team member — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", isolation: "SEEDED_CLONE" },
  { name: "outcome-bridge", cls: "SEEDED", why: "bridges canonical opportunities to pursuit outcomes; H1A: commits attribution, opportunities, outcomes, recompute requests and a revenue motion — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", env: OUTCOME_LEARNING_ENV, isolation: "SEEDED_CLONE" },
  { name: "motion-intel", cls: "SEEDED", why: "reads canonical motions and their briefs; H1A: commits ledger rows, governed invocations and team-member changes — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", isolation: "SEEDED_CLONE" },

  // These five were labelled EITHER and are not: each opens with an unqualified
  // `select ... limit 1` over a table it never wrote — `organizations`,
  // `change_ledger`, `pursuits`, `revenue_motions` — and then asserts against
  // whatever came back. On a disposable database that row does not exist and the
  // suite dies before its first assertion (Wave 6C §3). Two consequences worth
  // naming rather than hiding: they belong to SEEDED, and their "whatever is
  // first" reads are why accreted fixtures could change their verdicts without
  // anyone touching them. Tightening those reads is real work and is NOT done
  // here — Wave 6C classifies; it does not rewrite suites to be green.
  { name: "append-only", cls: "SEEDED", why: "reads the first existing ledger/override/invocation row; nothing to read on a bare database" },
  { name: "canonical-microloop", cls: "SEEDED", why: "reads a canonical pursuit with >=2 signals and a second existing org; H1A: commits route snapshots, candidates, participants, overrides and ledger rows, and rewrites pursuits — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", isolation: "SEEDED_CLONE" },
  { name: "route-persistence", cls: "SEEDED", why: "reads a canonical pursuit with >=2 signals and its recorded route history; H1A: commits route snapshots, candidates, participants, overrides and ledger rows — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", isolation: "SEEDED_CLONE" },
  { name: "scope", cls: "SEEDED", why: "reads the oldest existing organization; fails with 'no org' on a bare database" },
  { name: "team-motion", cls: "SEEDED", why: "reads a canonical routed pursuit and an existing draft motion; H1A: commits a route selection, team invites/accepts, governed invocations and ledger rows (it once staled the certified Slice 2A Globex recommendation) — measured by the whole-world fingerprint, so it runs on a disposable seeded clone", isolation: "SEEDED_CLONE" },
  {
    name: "vnext-coordination",
    cls: "SEEDED",
    why: "vNext Slice 2A plan harness: reads the canonical Globex pursuit and its seeded recommendation, and exercises approve / adjust / decline / review / tenant / disclosure paths inside transactions that are ROLLED BACK — the world it reads is left exactly as it found it",
  },
  {
    name: "today-tenant",
    cls: "SEEDED",
    why: "Today/Queue tenant isolation (2026-09-14 hardening): reads every canonical org's Today (flag OFF and ON) and Queue inside READ ONLY transactions, then plants guest-org clones of real rows inside a transaction that is ROLLED BACK and proves the sponsor's surfaces do not move",
  },
  {
    name: "search-path",
    cls: "SEEDED",
    why: "H1B-0.1: temporary-schema shadowing of authorization-sensitive functions — negative control (0105's own rollback lines → the catalogue guard flags and EVERY exploit succeeds), forward (0105 → 0 unsafe functions, EVERY exploit fails), guard self-test, CREATE-on-public and SECURITY DEFINER EXECUTE assumptions. Exploits run as the REAL app_rw login; it ALTERs functions on the clone, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p45-approvals",
    cls: "SEEDED",
    why: "P45-2: the approval lifecycle. WAITING_FOR_APPROVAL was schema-legal since 0109 but unreachable, because governed_skills.approval_required was read nowhere. This proves the whole lifecycle through the REAL app_rw login and the product's own withTenantOrg: an approval-required action parks the run with no consequential invocation and no draft; resume alone cannot release it; an authorized approver resumes the SAME persisted run and exactly one execution follows; rejection terminates it durably as CANCELLED/APPROVAL_REJECTED without overloading the invocation vocabulary; the history is append-only with a terminal row that NAMES its request, and app_rw can neither update nor delete it. It proves the refusals — wrong principal, ordinary viewer, self-approval, another tenant — and the stale-authority rule, where a grant revoked, an actor suspended or a revision superseded WHILE THE REQUEST WAITS yields INVALIDATED rather than letting a human approve something that can no longer legally execute. It proves the three concurrent races (approve/approve, approve/reject, reject/reject) each produce exactly one terminal decision, one state transition and at most one consequential execution, with the loser told 'already decided'. It also proves the recursion base case: the decision capability itself can never require approval. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p6ig-governance",
    cls: "SEEDED",
    why: "P6-IG: intercompany governance gap closure. The disclosure/federation substrate is pre-existing and DEMO CERTIFIED; this proves the two gaps it did NOT close. FIRST, derivation authority was unenforceable: context_grants.purpose was free text with no vocabulary and no reader, and information_classes/retention_class were stored and NEVER read — every apparent read site was an INSERT column list — so a grant carried no machine-evaluable statement of what it permitted and `mayDerive` could not exist honestly. SECOND, pursuit_participants.effective_from/effective_to had ZERO references anywhere in src/, so a participant whose window had closed but whose state was still ACTIVE remained a participant INSIDE THE RLS PREDICATE ITSELF. 0112 closes both: a bounded governed-use vocabulary, a bounded information-class vocabulary with no OTHER and no wildcard, a bounded retention vocabulary, one conditional CHECK making a machine-governed grant necessarily DATA-kind, pursuit-anchored, class-bearing, retention-bearing and end-bounded, and the existing SECURITY DEFINER can_see_pursuit NARROWED to enforce the effective window (none added). The suite proves the governed-use/derivation split — CO_SELL_CONTEXT_DISPLAY authorizes rendering through the ladder and can never become derivation-capable however complete the other fields are — and that derivation denies on wrong purpose, wrong class, unmapped input, non-participant, legacy purpose_code NULL, revocation, expiry and pursuit terminality, while an org derives from its own information freely. It proves the database itself refuses a partially specified machine-governed grant through app_rw (ACTION kind, null/empty classes, null retention, null pursuit, EPHEMERAL or RETAINED without an end, and unknown purpose/class/retention values all rejected) while legacy rows stay valid with no backfill. It proves the effective window at BOTH the RLS and read-model layers on one transaction clock — before effective_from denied, at effective_from allowed, before effective_to allowed, EXACTLY AT effective_to denied, LEFT and REVOKED denied regardless of dates. It proves delegation and pursuit-level onward sharing are fail-closed because no authority lineage exists to prove attenuation from, that object-level onward=false is a hard denial and onward=true removes only that prohibition, that the pre-existing disclosure ladder does not regress, that ZERO safe-declassification transforms ship so any hidden input yields NOT_DISCLOSABLE, that the cross-org count floor of 5 is declared PRODUCT POLICY and not anonymity with counts of one suppressed and a differencing negative control, that the raw contribution readers are renamed unsafe_ with a source guard proving no path under src/app can reach them, that recipient-specific projections are private/no-store, and that a passive read appends no ledger row. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "portfolio-pertinence",
    cls: "SEEDED",
    why: "P2: portfolio pertinence — \"why THIS pursuit rather than another?\". D-017 established that this is a DIFFERENT computation from pursuit-scoped pertinence.ts, needing cross-pursuit inputs that module deliberately refuses; this is its sibling, not its extension. The suite is mostly PURE and runs against a FROZEN asOf, because a ranking suite whose expectations move with the clock cannot prove determinism — which also makes it immune to the CFR-1.2 clock class rather than merely tolerant of it. It proves the accepted golden ordering to 3dp; that 8 identical inputs give exactly one result and input order is irrelevant; and the VALUE-BASIS FIREWALL that the whole design rests on — value/case.ts states that the economic truths are not interchangeable and that modelled customer impact is NOT our revenue, so a modelled $1.2M and a pipeline $1.2M are different quantities sharing a currency symbol and are never placed in one percentile cohort. It proves two equal modelled impacts get equal standing, a sole modelled pursuit gets neutral 0.5, changing a pipeline magnitude cannot move a modelled standing (with a non-vacuous control showing it DOES move the pipeline cohort), changing a modelled magnitude cannot move any pipeline standing, and a conflicting or undefensible value case falls to UNESTABLISHED with zero commercial credit while still attracting attention through contextNeed — so a conflict is never counted as both value and need. The 0.60 MODELED weight is proven to be load-bearing by a negative control that raises it to 1.00 and shows both the score change and, on a ceiling-decisive fixture, an ordering flip; and no rendered string describes it as a confidence or a probability, because it is a product-policy weight and not an empirical estimate. It proves mid-rank percentile edges (n=0, n=1 neutral, all-equal neutral, outlier cannot collapse the rest), that D-018 disclosure filtering happens BEFORE the comparison set exists by showing a withheld pursuit yields byte-identical output to one absent from the input entirely, that comparative explanations are mechanically causal (largest positive delta in realised weighted contribution, never a signal with a non-positive differential, no model), that genuine ties are declared as ties with the identifier ordering named as a deterministic tie-break rather than given a fabricated business reason, that scope narrowing changes relative standing but never an absolute signal input, and that Today uses pertinence as its THIRD key only — never outranking decision class or operational urgency — and falls back to the pre-P2 commercial-priority band whenever no rank is supplied, which is what keeps the flag-OFF product byte-identical. Writes nothing, so it needs no clone",
  },
  {
    name: "p45-program",
    cls: "SEEDED",
    why: "P45-3: the sequential multi-step runtime. 0109 already gave steps a seq, a unique (run_id, seq), a position-bearing idempotency key and per-step retry state, and resumeRun already selected the lowest-seq eligible step — but startRun only ever created seq 1 and a successful step ended the run, so none of it was reachable. This proves an ordered caller-supplied program through the REAL app_rw login and the product's own withTenantOrg: a run and its whole program are born ATOMICALLY (an invalid step leaves zero run, zero steps and zero ledger residue even inside the caller's transaction, because a savepoint makes atomicity a property of startRun rather than of its caller); run identity hashes the WHOLE canonical ordered program, so the identical program replays onto the same run while the SAME STEPS REORDERED are a different program and a different program against a live run is an explicit conflict rather than a silent replay of work nobody asked for; ONE resumeRun advances at most ONE consequential step, so every step boundary stays a fresh authority boundary and no request can drain a program it was never separately authorized for; the audit contract is RUN_STARTED -> RUN_STEP_COMPLETED (intermediate) -> RUN_COMPLETED (final, never both), leaving a one-step run byte-for-byte the Slice-1 chain. It proves that a failed or blocked step NEVER lets the runtime skip forward (progress is the lowest-seq step that is not COMPLETED, so a later PENDING step is structurally unreachable while an earlier one is unresolved) and that P45-3 adds no BLOCKED recovery path; that ONE APPROVAL RELEASES EXACTLY ONE STEP even when the next step names the very same skill, because the gate now asks the append-only pursuit_run_approvals about the STEP rather than asking the run's mutable continuation; that a grant revoked or an actor suspended BETWEEN steps refuses the next one, since a pinned identity is not a pinned entitlement; that cancellation and supersession keep completed effects and record an unambiguous halt point, so CANCELLED never reads as 'nothing executed'; that concurrent resumes produce one effect and one transition; and that app_rw can rewrite neither a step's skill_id nor its args. Its negative control reproduces Slice 1's `ok ? COMPLETED` assumption and proves the suite would catch it. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p45-runtime",
    cls: "SEEDED",
    why: "P45-1: the governed Pursuit Runtime, Slice 1. A decided plan action executes through a P4 governed actor holding a capability grant and a P5 run/step, with dispatchSkill still the only consequential-action boundary. The canonical world has one plan, a single RECOMMENDATION revision, zero DECISIONs and zero campaigns, so there is nothing here to execute against — the suite plants its own org, pursuit, goal, plan, DECISION revision, campaign, actor and grant. It proves the happy path end to end (run -> step -> invocation -> ONE draft touch -> ledger -> COMPLETED); that a missing or revoked grant and a SUSPENDED actor both refuse to execute and create nothing; that a grant cannot override required_permission; that cross-org actor and run references are refused RELATIONALLY by the composite keys; that pause genuinely stops execution and resume continues from durable state; that retry is bounded, reuses the same step identity and produces one effect rather than one per attempt; that a run interrupted mid-dispatch recovers from the database alone; that a run pinned to a superseded revision is CANCELLED as PLAN_SUPERSEDED and never retargeted; and that every send surface stays at zero. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "dp1-snapshot-boundary",
    cls: "SEEDED",
    why: "D-P1: /pipeline computed open/total/weighted from its RENDERED set — narrowed by ?timeframe= and by the ecosystem scope — and wrote them into the canonical pipeline_snapshots (org_id, taken_on) row, so merely LOOKING at a 7-day view overwrote canonical history with filtered totals. This plants a disposable org whose deals close far out (so a 7-day view is materially different from canonical), independently recomputes the canonical metrics without calling the writer, and proves the writer persists exactly those; that repeated and filtered renders move the row not at all; that the PRE-FIX flow genuinely poisons the same row and the fixed writer cannot reproduce it; that concurrent writers all agree; that org A cannot touch org B under app_rw; that prior-date rows stay byte-identical; and that CFR-1.1 still holds. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "dg85-determinism",
    cls: "SEEDED",
    why: "D-G8-5: shared_in_evidence() ended `order by e.observed_at desc limit 20`, which is not total — with >20 eligible rows and several sharing an exact observed_at across the 20/21 boundary, heap/planner order decided which tied rows survived the CAP, and the one consumer (context/timeline.ts) re-sorts and re-slices, so a dropped row simply never reaches the timeline. This plants 30 eligible shares — 12 strictly newer, 12 sharing one observed_at spanning positions 13..24, 6 strictly older — and proves the selected 20 share ids are identical across five planner configurations, two heap layouts, owner and the real app_rw login, and forward / reverse / shuffled insertion; that the final key is s.id (evidence_shares PK) because one evidence object shared on two partnerships makes e.id non-unique; that a non-party sees zero, revoking a share or deactivating the partnership removes rows, and a ≤20 population is unchanged pre-fix and post-fix. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "semantic-determinism",
    cls: "SEEDED",
    why: "D-G8-4: proves the SEMANTICS, not merely stable ordering — provenance precedence on an exact confidence+recency tie (with HUMAN_ASSERTED vs SECOND_PARTY deliberately UNRESOLVED), a median over the whole eligible population plus a categorical mode that surfaces ties, identity resolved by canonical id / alias / normalized name / unique fuzzy with shorter-name, alphabetical, uuid and heap order all proven unable to decide it, ambiguity failing CLOSED at the ask-scope boundary without leaking candidates, in-force facts judged against an explicit asOf, and a campaign seed that is deliberate or null. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "persisted-determinism",
    cls: "SEEDED",
    why: "D-G8-3: plants ties on every scoped PERSISTED-choice path — a campaign's assets inserted in REVERSE with one created_at, two settlement opportunities sharing updated_at, tied brand profiles, tied propensity scores and equal-amount opportunities under the routines cap — then proves the persisted sequence round-trips to the composer's authored order, the settlement function returns a stable total order with a unique opportunity identity (and a non-party still sees nothing), and every selection is identical across five planner configurations, two heap layouts and both roles, with the pre-existing business ranking still dominating and the old untied clause as a negative control. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "partnership-app-rw",
    cls: "SEEDED",
    why: "H1B-0: every partnership / consent flow as the REAL app_rw login (RLS binding) — invite→redeem, context and list grants, the overlap ladder, evidence and skill shares, warm intros, joint pursuits, settlement, revoke — plus third-party, forged-row, self-approval, post-revoke and no-context refusals. One transaction, ROLLED BACK, on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "tenant-isolation",
    cls: "SEEDED",
    why: "H1A broad cross-tenant adversarial verifier: plants a foreign tenant (clones of the sponsor's own rows, every readable field marked) and crawls every room of the real production build, calls every non-HTTP surface and every audited write with foreign ids, then plants the same rows into the sponsor as a NEGATIVE CONTROL. It COMMITS the planted rows (the running app must see them), so it runs on a disposable seeded clone. Needs `npm run build` first",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "vnext-attention",
    cls: "SEEDED",
    why: "vNext Slice 2B Today/Queue harness: reads the canonical Globex pursuit and its seeded recommendation, runs every Today/Queue read inside READ ONLY transactions, and walks approve → verify → review → update inside transactions that are ROLLED BACK — the world it reads is left exactly as it found it",
  },
  {
    name: "demo-team",
    cls: "SEEDED",
    why: "reads the canonical global team requirements and the Globex hero team the seed assembles from them; READ-ONLY. Supplemental to the manifest, which counts no team table — the gap that let an in-place reseed ship a world with no pursuit team (2026-09-14)",
  },
  {
    name: "vnext-context",
    cls: "SEEDED",
    why: "vNext Slice 1 loader harness: reads the canonical world's richest pursuit and asserts the loader+read-model composition. Requested as EITHER, but EITHER means run-scoped fixtures on a DISPOSABLE database, and this harness is deliberately READ-ONLY — it writes nothing, so it can only read demo content, which is what SEEDED means. On a disposable database it would find no pursuit and assert nothing (the Wave 6C mislabelling, again)",
  },
  {
    name: "ordering-determinism",
    cls: "SEEDED",
    why: "D-G5-1 (H1B Gate 5) + D-G8-1 (H1B Gate 8): plants ordering TIES — seven equally-stale late-stage deals under a LIMIT, same-instant lists on an attributed renewal account, and several equally-attributed stakeholders on one opportunity — then proves Today's divergences, the Today overview, the renewal projection and the /pipeline stakeholder query return the exact documented key order, byte-identical across five planner configurations, two heap layouts and both roles (owner and the REAL app_rw login with withTenant's context), with eligibility unchanged and the old SQL as a negative control. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },

  // ── EITHER: run-scoped fixtures (per-run ids), no reliance on demo content.
  //    Because they need nothing from the demo world, they are given a disposable
  //    database — see verify-run.ts. Writing them into the canonical world was
  //    how it accreted state nobody had authored (Wave 6C §4).
  {
    name: "closed-loop",
    cls: "EITHER",
    why: "run-scoped fixtures; walks the whole loop over a world it builds itself",
  },
  { name: "contributions", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "disclosure", cls: "EITHER", why: "run-scoped fixtures; asserts the disclosure ladder" },
  { name: "entity-resolution", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "federation", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "governed-mutation", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "isolation", cls: "EITHER", why: "run-scoped fixtures; asserts tenant isolation" },
  { name: "observability", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "ops", cls: "EITHER", why: "run-scoped fixtures: COMMITS organizations, governed invocations and outbox rows to exercise the ops health and dead-letter reads (H1A: previously described as read-only, which it is not)" },
  { name: "outbox", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "outcomes", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "recompute", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "recompute-recovery", cls: "EITHER", why: "run-scoped fixtures" },
  { name: "tenant-flags", cls: "EITHER", why: "run-scoped fixtures" },

  // ── DEPLOYMENT_ONLY: needs an environment this container cannot provide.
  {
    name: "migrations-only",
    cls: "DEPLOYMENT_ONLY",
    why: "asserts that a database built by migrations ALONE (no bootstrap, no seed) is complete — it must connect to a separately provisioned migrations-only instance, by design",
  },
];

export function suitesFor(cls: VerifyClass | "ALL"): SuiteSpec[] {
  return cls === "ALL" ? SUITES : SUITES.filter((s) => s.cls === cls);
}

export function specFor(name: string): SuiteSpec | undefined {
  return SUITES.find((s) => s.name === name);
}
