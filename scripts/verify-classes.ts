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
    why: "P6-IG: intercompany governance gap closure. The disclosure/federation substrate is pre-existing and DEMO CERTIFIED; this proves the two gaps it did NOT close. FIRST, derivation authority was unenforceable: context_grants.purpose was free text with no vocabulary and no reader, and information_classes/retention_class were stored and NEVER read — every apparent read site was an INSERT column list — so a grant carried no machine-evaluable statement of what it permitted and `mayDerive` could not exist honestly. SECOND, pursuit_participants.effective_from/effective_to had ZERO references anywhere in src/, so a participant whose window had closed but whose state was still ACTIVE remained a participant INSIDE THE RLS PREDICATE ITSELF. 0112 closes both with TWO nullable columns and FOUR checks: a bounded governed-use vocabulary; a SEPARATE `governed_information_classes` carrying the machine-evaluable data classes; a bounded retention vocabulary; one conditional CHECK making a machine-governed grant necessarily DATA-kind, pursuit-anchored, GOVERNED-class-bearing, retention-bearing and end-bounded; and the existing SECURITY DEFINER can_see_pursuit NARROWED to enforce the effective window (none added). THE SEMANTIC FIREWALL IS THE POINT OF THE SPLIT: `information_classes` already carries Audience values in certified disclosure paths as well as data categories, so it stays LEGACY, untouched and unconstrained, while nothing in the machine-governed path ever reads it. The suite proves neither column can satisfy the other's contract — a legacy Audience value stays valid, a machine-governed grant carrying only legacy classes is REJECTED by the database, an Audience term in the governed column is REJECTED, a legacy grant whose legacy column happens to hold a governed WORD still confers no derivation authority, and no coalesce, union or fallback connects them. It proves the governed-use/derivation split — CO_SELL_CONTEXT_DISPLAY authorizes rendering through the ladder and can never become derivation-capable however complete the other fields are — and that derivation denies on wrong purpose, wrong class, unmapped input, non-participant, legacy purpose_code NULL, revocation, expiry and pursuit terminality, while an org derives from its own information freely. It proves the database itself refuses a partially specified machine-governed grant through app_rw (ACTION kind, null/empty governed classes, null retention, null pursuit, EPHEMERAL or RETAINED without an end, and unknown purpose/class/retention values all rejected) while legacy rows stay valid with no backfill. D-P6-1 IS CERTIFIED HERE: a governance instant read into a JavaScript Date is MILLISECONDS where timestamptz is MICROSECONDS, so an application round-trip evaluated up to 999us in the past and could ALLOW a participant RLS had already DENIED. Every live predicate now compares in SQL against coalesce($n::timestamptz, transaction_timestamp()); the suite proves the truncation is real (50/50 round-trips), that both boundaries hold EXACTLY (at effective_from ALLOWED, at effective_to DENIED), that 25 back-to-back probes of each boundary are deterministic, that RLS and the read model never disagree across 50 probes, and that an expiring GRANT behaves identically at its own boundary — with a positive control first, because a probe that cannot be shown to allow before the boundary cannot be trusted to deny at it. It proves delegation and pursuit-level onward sharing are fail-closed because no authority lineage exists to prove attenuation from, that object-level onward=false is a hard denial and onward=true removes only that prohibition, that the pre-existing disclosure ladder does not regress, that ZERO safe-declassification transforms ship so any hidden input yields NOT_DISCLOSABLE, that the cross-org count floor of 5 is declared PRODUCT POLICY and not anonymity with counts of one suppressed and a differencing negative control, that the raw contribution readers are renamed unsafe_ with a source guard proving no path under src/app can reach them, that recipient-specific projections are private/no-store, and that a passive read appends no ledger row. Finally it closes the rules whose SURFACE DOES NOT EXIST — no cross-org approval packet is shipped so none can be approved blind, the approval closure (runtime plus the dispatcher it calls) imports no cross-org CONTENT module and only an action-authority one, no governance module calls an audit writer, and every denial reason interpolates operation metadata only, never a withheld value. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p7-slice1",
    cls: "SEEDED",
    why: "P7 Slice 1: the governed experience spine, read-only. Proves the architecture the P7 contract fixes — PursuitQuery → closed registry → P6 governance → GovernedResultSet → deterministic computation → presentation — by running the SAME boundary the web route calls, as real app_rw. An unregistered metric, field or filter hard-fails BEFORE any database work, so an invented metric cannot cause so much as a query; a historical asOf is refused because Slice 1 has no historical semantics. Org entitlement denies even with the deployment master on, because a deployment switch is not a tenant decision. Tenancy decides membership: the owning org sees its pursuit, an unrelated org sees neither and cannot distinguish absence from non-existence. The metric proves mayDerive is NECESSARY BUT NOT SUFFICIENT — an owner computes from its own inputs, while a participant with no machine-governed grant gets a withheld result carrying no value, no zero and no partial sum, and a PURSUIT_INTERNAL field on a foreign pursuit is not disclosed to a participant. The withheld value must not appear in the response BYTES, not merely be unrendered. The result echoes its validated plan so the surface is re-derivable from the plan alone, two executions of one plan are identical, and the run writes nothing of its own. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "dhist2-history",
    cls: "SEEDED",
    why: "D-HIST-2: pipeline history has an explicit producer, honest provenance and a UTC day. Observing canonical state may not create history as a side effect of the observation, so the /pipeline render path holds no producer call, no INSERT and no UPDATE — a visit, a refresh, a prefetch or a crawl creates nothing. The explicit producer creates exactly one sample per org per UTC date, stamped scheduled_daily_v1, recording the org's FULL unfiltered pipeline; a second run neither duplicates the row nor REVISES it, so the day's sample is the first successful run and a retry cannot rewrite history. Provenance cannot be acquired accidentally: an insert omitting `source` fails rather than becoming legacy data, and the vocabulary is closed. The UTC date is identical under every session timezone, checked against a session-local date that genuinely differs so the check is not vacuous. The two consumers are not retyped here — their SQL is EXTRACTED from /pipeline's own source and executed, so a consumer that drifted back to \"find something old enough\" fails rather than passing beside a stricter copy: a legacy row at exactly −7 does not become last week, valid samples at −8 and −21 do not either, and only an exact valid −7 makes the comparison available; the calibration buckets require exact −30/−60 valid samples and are simply absent otherwise. Producing a sample changes no canonical business row. It COMMITS its fixtures, so it runs on a disposable seeded clone",
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
    name: "pilot-evidence",
    cls: "SEEDED",
    why: "Pilot Evidence Foundation (Slice 1): the anti-regret pass that captures only what a real pilot would otherwise lose PERMANENTLY. Three gaps, each found by tracing rather than assumed. FIRST, provenance: data_environment already exists on 25 tables and lineage.ts already keeps provenance separate from learning eligibility via an explicit allow-list, but the vocabulary could not say PILOT or CERTIFICATION -- and that had already begun to cost us, because 18 invocations including 4 of the 7 P8-0 observations are flagged PRODUCTION by a hardcoded /api/mcp default, and PRODUCTION is the sole learning-eligible environment. The suite proves the two dimensions stay separate: PILOT is real-world evidence and is deliberately NOT learning-eligible, because being real does not grant a training licence; CERTIFICATION is neither; DEMO is never; PRODUCTION remains both as the control that stops either filter passing by refusing everything; and the two SQL fragments are genuinely different, with PILOT present in one and absent from the other. It proves the widened CHECK accepts the new words while still refusing an unknown one, so the constraint was widened rather than removed. SECOND, the legacy certification manifest: a gate row keeps its ORIGINAL data_environment because history is never rewritten, and is nonetheless excludable deterministically by exact id rather than by timestamp or fixture-name folklore, with duplicate entries refused. THIRD, decision-time attention, which is the one fact unrecoverable at any price: P2 rank is computed at read time, never persisted, and depends on a comparison set that moves. The producer is EXPLICIT and runs on write paths only -- capturing during a Today render would reintroduce exactly the defect D-HIST-1 found and 6f3e65d closed, pipeline_snapshots written from a page render whose own comment read 'history accrues just by looking', which is why 97e975f0 could not be safely reconstructed during the P45-4 incident. It is self-deduplicating on a fingerprint of the ranking INPUT STATE, so an unchanged ranking writes nothing and there is no cadence to decide, while a REORDERING or a different algorithm version is a different state and IS captured -- the control that stops the dedup from silently swallowing real change. It proves rank, score, band and comparison-set size are preserved because a rank is meaningless without the set, that components carry only declared keys and numbers, and that topReasons prose never reaches the table. Finally it proves the refusals structurally: no label, outcome, reward or causality column or table exists, and PILOT was not quietly added to the learning allow-list. Append-only is proved by PRIVILEGE -- both new tables end at app_rw=ar like change_ledger, with RLS enabled and FORCED -- and the mutable outcome tables are named as non-evidentiary rather than quietly relied upon. THE CORRECTION PASS added the four things the first version left as prose. ELIGIBILITY IS NOW A COMPOSITION, and the suite demonstrates the defect before it demonstrates the fix: the learning allow-list ALONE admits a known mislabelled certification row, because saying PRODUCTION is exactly what is wrong with it, and only learningCorpusSql refuses it -- flanked by two controls, an identical PRODUCTION row that is NOT in the manifest and is still admitted, and a DEMO row refused although the manifest never mentions it, so neither half can be passing by refusing everything. PROVENANCE IS DERIVED FROM THE SUBJECT rather than defaulted: recordChange ends in `?? PRODUCTION`, which is how the hosted project came to hold change_ledger rows marked PRODUCTION whose pursuit is DEMO, in the one store that cannot be corrected by UPDATE; both opportunity emissions now read pursuits.data_environment server-side and the suite asserts the whole ledger trail of a DEMO pursuit is DEMO. CREATION IS DISTINGUISHED FROM IMPORT: promoting an ACTIVE motion originates a deal here and now, so it emits OPPORTUNITY_CREATED with an absent before_state, while the CRM import path records a crm_snapshots observation and deliberately claims no creation, because import time is not business creation time and no imported column carries the real one. THE AMOUNT-ONLY EVENT IS PROVED UNREACHABLE rather than instrumented -- no application path mutates amount_usd after creation, and a raw UPDATE is shown to produce no history at all, which is why no such path may exist. It also proves the observation is server evidence: a dispatch that fails after staging leaves NO orphan (staged, then rewound to zero through a savepoint), the producer's input type accepts no caller-supplied rank, score, fingerprint or eligible set, the fingerprint is computed from the server-ranked view, the entire P2 ranking completes inside a READ ONLY transaction so the database itself enforces that looking writes nothing, and no entry point reads dataEnvironment from a request body, params or tool arguments. Every structural assertion scans source with COMMENTS STRIPPED, after two of them first failed against the prose explaining the very invariant they check. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p8-0",
    cls: "SEEDED",
    why: "P8-0: the immutable execution-evidence spine future P8 learning consumes; it implements no learning. The distinction it exists to defend is SUPPORTED-AND-EMPTY versus UNOBSERVED -- a marked invocation of a registry capability with zero effect rows is the fact that it created nothing, while an unmarked one with zero rows is an absence of evidence, and a suite that could not tell those apart would certify nothing. So every zero-row case asserts the marker too. It proves the database, not application code, decides who may be marked: observation_contract_version = 1 is refused by CHECK for an unregistered capability, for a wrong version of a registered one, and for any other integer, while NULL is always legal and a real registry member is accepted -- the positive control that stops the CHECK from passing by refusing everything. It proves the four frozen v1 contracts against their exact write inventories: draft_campaign_touch records exactly one CREATED campaign_touch and records ZERO when no campaign matched; recommend_pursuit_plan records three on a fresh pursuit -- goal, plan and revision, each staged AT its creation branch because a return value cannot distinguish created-now from already-existed -- and ZERO on an UNCHANGED re-recommendation (D-028); decide_pursuit_plan records exactly two when staging occurs and NEVER records the pursuit_goals and pursuit_plans status transitions to ACTIVE, which are frozen as internal parent lifecycle rather than attributable effects; assemble_pursuit_team records exactly one ref per member actually inserted and, on a repeat where every role is already filled, is MARKED with zero refs -- the canonical supported-and-empty case, and the reason the marker lives on the required parent rather than on an optional child. It proves THE FAILURE RULE, which is the one thing a database rollback cannot give you: a handler that writes durably, stages an effect and then throws must leave a FAILED invocation with zero refs, because a PostgreSQL savepoint rewinds the database but not JavaScript memory -- the suite asserts the staged entry is gone, the durable write is gone, and no ledger row survives. It proves the canonical invocation id is server-allocated and that a payload named invocationId or effects has zero authority over it, that both ledger events of the two-event decide path carry that same id (the relation is one-to-many, which is why emitted_event_id stays dead), that a cross-org effect row is refused RELATIONALLY by the composite parent key added in 0117 with a same-org positive control beside it, and that immutability is a PRIVILEGE property: app_rw cannot update observation_contract_version, cannot update or delete effect refs, and can still update status -- so 1 to NULL and 1 to 2 are structurally impossible. Finally it proves the deferred areas are STRUCTURALLY ABSENT so nothing can quietly begin claiming them: no model usage, receipt or outcome table exists, no model/token/cost column was added, nothing writes emitted_event_id, and agent_runs is not joined to the spine. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p45-4",
    cls: "SEEDED",
    why: "P45-4: a governed AGENT actor executes a granted capability. governed_actors has admitted AGENT since 0109 and holds zero rows, while an AGENT actor ALREADY executes governed writes in production -- /api/mcp builds Actor{type:'AGENT', id: key.keyId} from an API key and dispatches draft_campaign_touch, passing no governedActorId, so the 0109 grant gate never engages and agent authority comes from a KEY SCOPE rather than a grant to a durable actor. This proves the closure of that gap through the REAL product path: the deployed /api/mcp route handler, a real bearer, resolve_api_key, the trusted credential, the MCP actor, the exact live grant, dispatchSkill, a real draft campaign touch and its audit row. It proves the THREE IDENTITIES stay three facts in three columns -- actor_id remains the credential (unchanged legacy semantics), governed_actor_id the durable agent, grant_id the instrument that authorized it -- and that the invocation records the exact grant the authorization query returned rather than a later guess. It proves a payload cannot nominate authority: governedActorId, actorId, grantId, orgId and organizationId are each REJECTED at the boundary and dispatch nothing, never silently ignored. It proves lifecycle (DRAFT/SUSPENDED/RETIRED each refuse AT THE LIFECYCLE CHECK, and restoring ACTIVE restores execution so the control bites both ways); that a grant confers authority and nothing else does (missing, revoked and EXPIRED each refuse at the grant check, the refusal attributes no grant, and expiry is decided by transaction_timestamp() with the fixture boundary set IN SQL so no instant crosses into JavaScript and the P6-IG microsecond truncation cannot occur); that an expired-but-ACTIVE grant is dead for authority yet still occupies the partial-unique ACTIVE slot, so renewal is revoke-then-insert; and the one sequence that proves version semantics without ever re-pinning an immutable instrument -- an ACTIVE @2 grant does not authorize @1, a NULL/wildcard grant does not satisfy strict AGENT enforcement, and a revoke-then-insert @1 grant does, with the NEW grant id recorded. It proves a grant may narrow but never rescue (a grant for a skill whose registry excludes AGENT still fails at eligibility), that foreign-org credential bindings and grants are refused RELATIONALLY by the composite keys, and that an unknown actor is disclosed as unknown rather than as a permission failure. It proves the binding is immutable after issue by PRIVILEGE rather than convention, and that grant_id and expires_at are likewise immutable by omission. It proves both postures: OFF plus an unbound legacy credential executes exactly as Slice 14 certified with NO governed actor or grant invented, ON plus an unbound credential refuses at the new mandatory-binding check, and -- the contradiction this slice had to find -- OFF plus a BOUND credential with no live grant ALSO refuses, by the pre-existing 0109 gate, because binding a credential is not inert. It proves WORKER dispatch is untouched under both postures, that the independent pre-existing agent/human boundary still holds (an AGENT may never assert a VERIFIED stakeholder role), that the recreated resolve_api_key kept SECURITY DEFINER and 0105's hardened search_path, that exactly one definition of grant liveness exists in src/, and -- blocking -- that deleting a tenant holding an actor, a bound credential, a grant and an executed invocation cascades cleanly, which is what makes the NO ACTION grant reference safe. It records NO model, token or cost attribution, and asserts no such column exists: on the MCP path PursuitOS performs no provider call and observes none of those facts. Every refusal asserts the RECORDED REASON so it certifies the check that actually fired. It COMMITS its fixtures, so it runs on a disposable seeded clone",
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
    name: "p3-2c-gate",
    cls: "SEEDED",
    why: "P3 Slice 2C-A: the v2 WRITE-activation gate. e55499b reads schema-2 plan content without failing and gets it wrong -- empty action block, unresolvable lineage, every v2 plan permanently stale, then a fresh v1 recommendation approved over the top -- so rollback to it ends at the first persisted v2 revision, and PLAN_CONTENT_V2_WRITES_ENABLED is what makes that moment deliberate. This proves the gate governs WRITES ONLY: with it OFF a recommendation persists as schema 1 with a nextAction, no actions[], a v1 basis and no lineage columns, and its decision persists as schema 1 staged the v1 way with the pointer inside the content; with it ON both are schema 2 with a v2 basis and structural lineage whose key is a proven member of that revision's action set. The schema-preservation rule is proven in both directions: generating while OFF then flipping ON leaves the decision at schema 1 (never upgraded), and generating while ON then flipping OFF REFUSES the decision before any mutation, with the whole-world fingerprint identical across the refused attempt and the recommendation left intact rather than downconverted. It proves v2 data plus gate OFF is a supported state -- Pursuit Detail, Today, Queue lineage and approvals all answer over a schema-2 revision while writes are disabled -- and that an unknown schema still fails closed in either posture. Parsing is the repository's canonical opt-in idiom with no permissive truthiness (absent, empty, false, 0, off, no and unrecognised values are all OFF; true, 1, on, yes are ON). It proves the gate is not authority: the same authorized actor takes the same decision in both postures wherever the representation permits, and the one refusal is a disabled-write-path error rather than a permission denial. Finally it certifies the serializer inventory structurally -- exactly one production module inserts plan content, at exactly two sites, one consulting the gate and one inheriting its parent revision's schema -- and that no reader consults the write brake. It COMMITS its fixtures, so it runs on a disposable seeded clone",
    isolation: "SEEDED_CLONE",
  },
  {
    name: "p3-2c",
    cls: "FRESH",
    why: "P3 Slice 2C-A: plan-action lineage, as the DATABASE enforces it. A v1 plan carried its staging pointer inside its own immutable content, which worked only because exactly one action was ever staged at the instant the decision was written; a v2 plan carries up to three and stages them as commercial state progresses, so lineage moved to the mutable motion_actions row (0115). This proves the constraints rather than the intent: a cross-tenant revision reference is refused by the composite tenant FK; a revision without an action key and a NULL TENANT with live lineage are both refused by the live-lineage CHECK (the FK is MATCH SIMPLE and would not catch the second on its own); a duplicate (org, revision, action key) is refused by the partial unique index while a different action of the same revision stages normally; and a legacy all-null row is accepted with no backfill. Every refusal is paired with a control showing the legal shape accepted, so a suite that refused everything would fail. It then proves an explicit outcome for every way a parent can disappear: a direct revision delete and a pursuit cascade both leave the queue row alive with plan_revision_id nulled and org_id and the action key intact — matching the repository's existing position, since `revenue_motions -> pursuits` is SET NULL and motion work outlives the pursuit — while deleting the motion cascades its actions and touches no plan history, and deleting the organization removes both sides with no dangling reference. A detached row resolves to no live lineage, keeps its key as provenance only, and sits outside the live-lineage unique index; lineage resolves with the ledger row deleted, because the ledger corroborates and never defines. Finally it proves the two lineage reads are disjoint and explicitly versioned — v1 only through a schema=1 branch, v2 only through the structural columns, and an unknown schema carrying a v1-shaped pointer resolving to nothing — and that no run, step, approval or invocation row exists, because plan content confers no authority and 2C-A compiles to nothing. It COMMITS its fixtures and needs the full schema, so it runs on a disposable migrated database",
  },
  {
    name: "dp6-multigrant",
    cls: "SEEDED",
    why: "D-P6-DERIVATION-MULTIGRANT: the one-row derivation-grant loader ended `limit 1` with no `order by`, so with several equally qualifying grants PostgreSQL guaranteed nothing about which one was seen — and the pick decides the answer, because grants differ in retention_class and scope.keys. A viewer holding a broad grant and a narrow one could be refused a derivation the broad grant plainly permitted, on the strength of physical row order. The historical selector is kept in the suite as a NEGATIVE CONTROL: against the same two-grant fixture the core's verdict on each qualifying grant taken alone is one ALLOW and one DENY, which is the choice set an unordered limit-1 was free to return, while the union rule allows. Which row the control actually returns is deliberately NOT asserted — pinning today's heap order would be pinning the defect. It also proves the other half of D-S14-EXECUTION-BOUND: that the one-row `mayDerive` and the cohort loader `loadCohortDerivationFacts` acquire the SAME facts from a real database under a real app_rw session across eleven grant shapes (permitting, narrowed, narrowed+permitting, two narrowed, RETAINED+PURSUIT_LIFETIME on a merged pursuit, PURSUIT_LIFETIME alone on a merged pursuit, expired+live, wrong/right purpose, wrong/right class, revoked+live, and no grant at all), with an anti-vacuity check that the cases produced both ALLOW and DENY — batching changed fact acquisition, not governance meaning. Finally it records that first-by-id is deterministic DIAGNOSTIC selection and not precedence: both loaders order by id so an explanation can cite a grant, and removing the cited grant changes the citation without changing the decision. It COMMITS its fixtures, so it runs on a disposable seeded clone",
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
