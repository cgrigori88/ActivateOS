# UI Redesign — Wave 6: Whole-Product Reconciliation & Release Candidate

**Starting SHA:** `40b576510b60b5824b2861e5ecff2875b4cdb537` (`ui-wave-5`)
**Branch:** `ui-wave-6`
**Final SHA:** this commit — the tip of `ui-wave-6`. A commit cannot carry its own hash; read it with `git rev-parse ui-wave-6`.
**Scope:** UI / IA / presentation, plus verifier-fixture repair. No schema, migration, RLS, tenant, disclosure, federation, scoring, Ask-authorization or provider-integration change. No constraint weakened. No production data semantics changed. No deployment configuration touched. **Not deployed.**

## RELEASE DECISION

# NO-GO

**Blockers, in order of severity:**

1. **The configured database is unreachable from this environment.** `connect ETIMEDOUT` to `aws-0-ca-central-1.pooler.supabase.com:5432`, reproduced with a bare `pg` client. DNS resolves and HTTPS egress works; raw TCP to 5432 and 6543 is blocked. Per §1 this alone forbids release certification.
2. **The deployed demo's credential state cannot be verified from here** (§10). `/api/build` requires `OPS_FINGERPRINT_TOKEN` or an authenticated session; neither is available. **Sending cannot be proven impossible, so it must not be claimed.**
3. **Disclosure certification (§11) and Ask certification (§12) were not run against the certification environment.** They were exercised against local databases only — that is review, not certification.
4. **Three verifiers remain fatal for reasons now understood but not fixed** (§2/§16): `pursuit-verify`, `facts-verify`, `governance-verify`.

Everything below is the local presentation-only review §1 permits, plus the §2 test-drift work, which is real and is committed.

---

## §1 Entry gates

| Gate | Result |
|---|---|
| Working tree clean at start | yes |
| local `ui-wave-5` == `origin/ui-wave-5` | yes — both `40b5765…` |
| Waves 1–5 in ancestry | yes — `41e66dd`, `c34a16a`, `821da79`, `fcee418`, `40b5765` |
| `origin/claude/activateos-platform-review-xzkgmd` | `66f72f61228588d70bee18771c5753e355e0a7c2` — unchanged |
| Any Wave 2–5 commit on that branch | **none** — all four confirmed absent |
| DB-backed verifier environment | **UNAVAILABLE** |

---

## §2 Test / schema drift — root cause and fix

### It was never a schema problem

`taxonomy_nodes.slug` has been `text not null unique` since `0001_core_schema.sql` and **no later migration alters it**. The schema is right. The verifiers were wrong.

### The real root cause is bigger than the slug

Five verifiers — `pursuit`, `routes`, `experience`, `facts`, `governance` — were written to run against a **disposable, freshly-migrated database**. Their own defaults say so: `DATABASE_URL_VERIFY` falls back to `postgresql://postgres@127.0.0.1:5433/wsa_verify` and `…/wsc_verify` — a scratch instance on port 5433 that does not exist in CI or in this container. Their fixtures **COMMIT** and use **hard-coded values on uniquely-constrained columns**.

Run against a persistent database — which is what the battery has actually been doing — they collide. `taxonomy_nodes.slug` was simply the **first** constraint they hit, which is why it was the only symptom anyone ever saw. It was masking a stack.

**Verdict: stale verifier fixtures, and a verifier harness whose environment contract was never provisioned.** Not migration drift, not a schema expectation mismatch, not an application defect.

### The smallest correct fix

Four scripts, matching the convention the other fifteen verifiers already use (a per-run `RID`):

| Defect | Truth | Fix |
|---|---|---|
| `insert into taxonomy_nodes (name)` — 5 sites in 4 scripts | `slug` is `not null unique` since 0001 | insert `(name, slug)` with a per-run slug |
| `insert into score_versions (label, description)` | `weights` is `jsonb not null`, no default; `label` unique | supply `weights` and a per-run label |
| `company_hierarchies (… relation)` | the column is `relationship`; `relation` never existed | use `relationship` |
| `org("Tenant A")` / `org("Tenant B")` | `organizations_name_key` is unique | per-run org names |

**No constraint was weakened.** No application code was touched. No production data semantics changed.

### Proof, on a brand-new database per suite

| Suite | Before | After (own fresh DB) |
|---|---|---|
| `routes-verify` | FATAL — 0 assertions ran | **63 passed, 1 failed** |
| `experience-verify` | FATAL — 0 assertions ran | **33 passed, 1 failed** |
| `pursuit-verify` | FATAL (slug) | FATAL — `pursuit_evidence_ref_fk` violation |
| `facts-verify` | FATAL (slug) | FATAL — signal references unverified evidence |
| `governance-verify` | FATAL (aborted txn) | FATAL — aborted txn, cause now located |

96 assertions that had never executed now execute, and three genuine defects that the slug error had been hiding are now visible. **That is the honest outcome: the fix did not make five things green, it made two things green and made three real problems legible.**

### The three that remain — explained, not fixed

- **`governance-verify`** — the cause is located: `src/lib/pursuits/federation/skills.ts:295`, inside E3-D.4 "Cross-tenant action authority". The test deliberately provokes an unauthorized cross-tenant action; the rejection surfaces as a Postgres error that aborts the transaction, and the script then keeps issuing commands on it. It needs a `SAVEPOINT` around the expected-to-fail step. Whether the refusal *should* be an application-level refusal rather than a database error is a domain question, and answering it means changing `skills.ts` — application code, outside this wave.
- **`pursuit-verify`** — `pursuit_evidence_ref_fk`: the fixture writes a `pursuit_evidence` row whose referent does not exist yet. Ordering defect in the fixture.
- **`facts-verify`** — the fixture attaches a signal to evidence that has not been verified, which the domain correctly refuses.

All three are fixture defects of the same family, and all three are now reproducible on demand.

### A second, structural finding

The battery has **two incompatible environment requirements** and no single database satisfies both:

- **Fixture-committing suites** (pursuit, routes, experience, facts, governance) need a *fresh* database per run. They are not idempotent — re-running against a database they have already touched reintroduces the alias/DUNS/name collisions.
- **Seed-dependent suites** (`interpret`, `lifecycle-query`, `lifecycle-acceptance`, `value-case`, `stakeholder-intel`, `partner-intel`, `outcome-bridge`) need a *demo-seeded* database. On a bare migrated one they fail with `Cannot read properties of undefined`.

This is why no single run of the battery has ever been green, and it is real harness debt independent of anything in Waves 1–6.

---

## §16 Verification battery

### What ran clean everywhere

| Check | Result |
|---|---|
| `tsc --noEmit` | **clean** |
| `next build` | **clean** |
| `npm test` (unit) | **149 passed, 0 failed** |
| `visual-system-check` (12 rules, **362 files**) | **clean** |
| Full application crawl — 28 rooms + 230 discovered link targets | **all 200; 0 JS/console errors; 0 horizontal overflow** |

### DB-backed suites, seeded database (`pursuit_demo`) — baseline before Wave 6 changes

`append-only 11 · canonical-microloop 23 · closed-loop 18 · contributions 12 · disclosure 21 · entity-resolution 11 · federation 19 · governed-mutation 13 · interpret 255 · isolation 12 · lifecycle-query 80 · observability 13 · ops 10 · outbox 20 · outcomes 18 · partner-intel 17 · recompute-recovery 8 · recompute 20 · route-persistence 10 · scope 17 · stakeholder-intel 43 · team-motion 22 · tenant-flags 13 · value-case 126`

**= 812 passed, 0 failed across 24 suites.** Plus `motion-intel` 18/1 (see below).

### Failures and their explanations — nothing unexplained

| Suite | State | Why |
|---|---|---|
| `pursuit`, `facts`, `governance` | FATAL | fixture defects, root-caused above; three real problems newly exposed |
| `routes` | 63/1 | `team assembled from required roles — created=0` — genuine assertion failure, newly reachable |
| `experience` | 33/1 | `restricted raw value present for internal caller` — genuine, newly reachable, **and a disclosure-adjacent assertion that must be resolved before any GO** |
| `motion-intel` | 18/1 | `Brief motion-context check (no linked motion)` — pre-existing, unrelated to Waves 1–6 |
| `migrations-only-verify` | N/A | **intentionally inapplicable here**: it targets `127.0.0.1:5433`, a migrations-only scratch instance that this container does not provision |
| `interpret`, `lifecycle-*`, `value-case`, `stakeholder-intel`, `partner-intel`, `outcome-bridge` | FATAL on a bare DB | need demo seed data; **green on the seeded database** |

**`experience-verify`'s surviving failure is the one I would not ship past.** It asserts something about restricted values reaching an internal caller, and until it is understood it sits directly on the §11 disclosure gate.

---

## §3 Semantic consistency

Audited across the authenticated app. The uncertainty vocabulary is used **uniformly and deliberately**: `UNKNOWN` renders as an uppercase token — never as `0`, `—`, `false`, or a blank — in the stakeholder path, lifecycle timing, value case, partner latency, constraint severity, and Insights attribution. §10's health vocabulary (Healthy / Degraded / Stale / Unavailable / Not configured / Disabled) is shared from one module and reused for worker status.

The recommendation ≠ decision ≠ action ≠ outcome separation holds and is now *structurally* enforced by the execution spine, which renders those as distinct stages rather than degrees of one status.

**Two registry words were still leaking to operators and are fixed** (carried in from Wave 5's contact work): `unknown` engagement now reads "no reply yet" in the list and "nothing received back yet" on the detail page.

---

## §4 Money and value semantics — two real ambiguities fixed

Facts were not altered. Labels were.

| Was | Problem | Now |
|---|---|---|
| Pipeline: **"total pipeline"** | "total" reads as the whole book including closed. It is the *unweighted sum of open opportunities in the current filter* — the same population the tile beside it weights. | **"open pipeline"** · *opportunity amounts, unweighted* |
| Pipeline: **"weighted"** | basis stated but not population | **"weighted"** · *same deals × stage probability* |
| Motions: **"est. pipeline"**, linked to `/pipeline` | **motion-level** value labelled as pipeline and linked to the room showing an **opportunity-level** figure — inviting the operator to expect the same number and find a different one | **"motion value"** · *estimated, across the plays*. The link is removed: these answer different questions and reconciling them is not a click. |
| Motions: **"expected"** | "value × propensity" — which value? | *motion value × propensity* |

The layers now read distinctly on screen: **$250K motion-level** per queue row, **$6.25M open pipeline / $2.61M weighted / $2.51M won** at opportunity level, and per-deal amounts on the records themselves.

I did **not** verify the $1.25M / $3.67M / $6.25M canonical demo triple, because the canonical demo database is unreachable. The local demo shows $6.25M whole-book, consistent with the third value.

---

## §6 OperatingSpine — chrome compressed

Waves 3, 4 and 5 each shipped a spine, each a near-copy: **three components, 370 lines, one presentation written three times.** Worse, that presentation had become a teaching banner — every node stacked three lines (word / clause / count), so six nodes stood ~64px tall on fifteen rooms, and **at 1280px the clauses truncated into fragments** ("what the outcomes tau…") that taught nothing and still cost the space.

`src/components/operating-spine.tsx` is now the single presentation. The clause renders **only on the node the reader is standing on** — the one place it is useful — and lives in a `title` on the others.

Preserved, as §6 requires: current position (raised surface, priority ink, dot, `aria-current`), adjacent context (every node still named), conceptual flow (arrows, fixed order).

**Verified at 1280 / 1440 / 1728: one line, no truncation at any width.** Height is roughly a third of what it was. The three spine files are now vocabulary only.

---

## §7 KPI compression

| Room | Was | Now |
|---|---|---|
| **Contacts** | 6 tiles carrying 3 facts — total, reachable and the two type counts that sum to the total, with the headline card directly above stating total and reachable **in a sentence** | 4 tiles, each a distinct cut and a filter entry point. Nothing lost: the total and reachable count are the headline. |
| **Queue** | 5 tiles that are **nested, not peers** — "this week" already contains overdue and today; "open actions" contains all three | 3–4 tiles; the total moved to the spine (stated once), and the window tile now says *"includes overdue and today"* rather than implying a separate bucket |

Pipeline's registered-deals tile was already conditional (Wave 5). Today and Goals carry no KPI band — Goals' was removed in Wave 3.

---

## §8 Pipeline Attention — the work is now the hero

**Was:** in the Attention view the operator scrolled past tie-out, "fix the CRM", forecast accuracy, and the renewal radar — roughly a full screen — before reaching the first deal needing a human.

**Now:** those four sit behind one line — *"Portfolio analysis — tie-out, CRM fixes, forecast accuracy, renewal radar"* — **in the Attention view only**. In Portfolio, All and Review, whose whole purpose is the aggregate picture, they remain open exactly as before. Nothing removed, no fact changed.

Verified in the capture: the first intervention record (*Sovereign landing zone · $1.45M · stalling · no activity in 14d*) sits at ~435px, inside the first viewport, with the view switcher above it.

---

## §14 Application crawl — production build

28 authenticated rooms visited, then **230 discovered link targets followed** (not merely checked for `href` existence).

**Result: every target 200. Zero JS errors. Zero console errors. Zero hydration failures. Zero horizontal overflow at 1440.**

One entry needs explaining rather than fixing: `/accounts/export` reports "Download is starting" to the crawler. That is a CSV download endpoint behaving correctly; it is not a broken route.

---

## §15 Screenshot review

21 rooms at 1440; seven key rooms additionally at 1280 and 1728. Reviewed as one product.

The rooms read as one system: shared spine grammar, one segmented-control grammar, consistent card density, consistent empty-state voice ("Nothing to analyse yet", "No source has contributed evidence yet", "You're caught up"), and one status vocabulary. No room reads as a prototype, a developer console, or a disconnected feature. Where a room is empty it says why and what happens next.

No new cross-product inconsistency was found that warranted reopening successful IA.

---

## §10 Send safety — HARD GATE: **NOT SATISFIED**

| Requirement | State | Verified how |
|---|---|---|
| Demo environment identity explicit | `siteMode()` / `environmentLabel()` exist and are reported by `/api/build` | source |
| Autosend OFF | `OUTREACH_AUTOSEND` absent from `.env.local` and unset; `externalSendingArmed()` is fail-closed — anything but the exact string `"on"` is off, and the public site can never send | source + env |
| Outbound actions governed | send path persists `draft`, approval gates unchanged | source |
| Fail-closed without a credential | `send.ts` marks the message `failed` and throws **before** a provider is constructed | source |
| **Demo deployment has no usable external-send credential** | **UNVERIFIED** | — |

`RESEND_API_KEY` is present in the local `.env.local` (value never printed, never changed, never rotated). **The deployed demo's environment cannot be read from here**, and §10 forbids relying on the UI being disabled or on `OUTREACH_AUTOSEND` alone.

**I cannot prove the demo is incapable of sending, so I do not claim it.** This remains the deployment-certification gate opened in Wave 5.

---

## §11 / §12 / §13 — not certified

- **§11 disclosure** — `disclosure-verify` (21), `isolation-verify` (12), `federation-verify` (19), `scope-verify` (17) and `governed-mutation-verify` (13) all pass on the local seeded database. That is **not** the sponsor⇄partner browser proof §11 specifies (DOM absence, serialized-payload absence, hydrated-state absence after participant switch, back/history), and it is not the certification environment. **`experience-verify`'s "restricted raw value present for internal caller" failure sits directly on this gate and must be resolved first.**
- **§12 Ask** — the hero query returned a coherent, provenance-backed answer against the local demo database in Wave 5 ($2.91M over 3 pursuits, 4 constraints satisfied), and `interpret-verify` passes 255 assertions on the seeded database. The adversarial/injection case was **not** run in this wave.
- **§13 cross-room reconciliation** — the local demo carries only a subset of the canonical hero records. Reconciling the canonical set requires the canonical database.

---

## §5 / §9 — audited, unchanged

- **§5 dates.** Business-facing dates render as `YYYY-MM-DD`; ranges stay ranges (`0-90d`, `3-6m`); relative urgency is worded ("silent 21+ days", "no activity in 14d") and kept distinct from exact dates; evidence provenance keeps full timestamps. No mixed raw ISO datetimes found on business surfaces. No change made.
- **§9 Pursuit Detail.** The first viewport answers all seven questions, the sticky rail and anchors work, evidence remains behind disclosure. **No regression found, so the information model was not reopened.**

---

## Remaining known debt

1. **Deployed demo credential state** — §10. Needs someone who can read that environment. **Blocks GO.**
2. **`experience-verify`: restricted raw value present for internal caller** — disclosure-adjacent. **Blocks GO.**
3. **`pursuit-verify` / `facts-verify` / `governance-verify`** — three fixture defects, root-caused, reproducible, unfixed.
4. **`routes-verify`: team assembled from required roles — created=0** — genuine, newly reachable.
5. **Verifier harness has no provisioned environment** — needs a fresh database per fixture-committing run and a seeded one for the read suites. Until then the battery cannot be green in one pass.
6. **`motion-intel-verify` 18/1** — pre-existing, unrelated to this series.
7. **Canonical value triple ($1.25M / $3.67M / $6.25M) unverified** — needs the canonical database.

---

## Success test

The authenticated product now reads as one system: commercial intent → joint pursuit → governed execution → observed outcome → learning, with one spine grammar carrying the reader between them, one uncertainty vocabulary, one money vocabulary that names its layer, and evidence, disclosure and human authority preserved throughout.

What it is not yet is *certified*. The gap is not design — it is that the environment which would prove the security, disclosure and send claims could not be reached from here, and that four verifier assertions are still unresolved. Those are the specific, addressable conditions for a GO.
