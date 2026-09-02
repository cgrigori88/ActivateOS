# UI Redesign — Wave 5: Intelligence, Evidence, Learning & System Health

**Starting SHA:** `fcee418928a5d4e1e4b026836f967b4f4ed9e120` (`ui-wave-4`)
**Branch:** `ui-wave-5`
**Ending SHA:** `209c6665f78981d52f1074f5f79c20c6a8fc91f1`
**Scope:** UI / IA / presentation. No schema, migration, RLS, tenant, disclosure, federation, scoring, Ask-authorization, provider-integration, lifecycle or auth change. External sending remains OFF and fail-closed. No deployment configuration touched. No deployment performed. Landing page untouched.

---

## The finding that shaped this wave

Every room in this wave was individually defensible and collectively silent about the one thing that makes the product credible: **that an answer is only worth the evidence behind it, and the evidence is only worth the feed that produced it.**

Provider health made the point sharpest. Nineteen feeds rendered as three tables of eleven columns, keyed on the registry's own identifiers — `pdl_company`, `sec_edgar`, `builtwith_domain: DISABLED_NO_CREDITS` — with almost every cell an em-dash. The room existed to answer *can I trust what this system knows right now?* and that sentence appeared nowhere on it. A reader could not have told a healthy feed from a dead one without decoding enum constants.

Contacts had the same disease in a different organ: twelve columns per person, of which nine were an em-dash for a typical end user, because Territory, Vertical and Segment are attributes only a captured partner rep carries. A grid that is mostly dashes teaches the reader to stop reading it.

Both are now written as sentences first, with the mechanism preserved one click away.

---

## Room by room

### Provider health (§6/§10) — operating confidence, not a registry dump

**Was:** three eleven-column tables; provider ids as the primary column; raw enums (`FIRMOGRAPHIC`, `LOW_COST`, `PUBLIC_COMPANY`) as type and cost; failure codes in a footer; health nowhere stated.

**Now:** a headline sentence in §10's vocabulary, then named feeds saying what evidence each produces, when it last refreshed, and what its state *means*. `src/lib/intel/provider-presentation.ts` (new) is the single place the vocabulary lives:

| State | Meaning shown to the reader |
|---|---|
| Healthy | recent runs succeeded |
| Degraded | running, but recent failures in the window |
| Stale | last successful run is older than 14 days |
| Unavailable | the last run failed |
| Not configured | needs an account, key or credits before it can run |
| Disabled | switched off deliberately |
| Not yet run | registered, never called in this workspace |

Run counts, spend, the sparkline, `disabledReason` and `lastError` are all preserved behind **Run detail** — that data is real and occasionally needed, it simply is not the headline. The registry id lives there too, for whoever needs to grep for it.

**Density.** Giving all nineteen feeds a card ran the room to ~2,700px, and sixteen of them share one benign state (registered, never run here). A room that exists to answer *is anything wrong?* must not make the reader scroll past sixteen identical "nothing is wrong" cards. Feeds that have run, or that need a decision, get the full card; the untouched majority is listed compactly underneath with the same names and states. Nothing is hidden.

**One honesty fix found by inspection.** The headline first read *"All 19 feeds are in a healthy or expected state"* while three of them could not run at all. It now says *"No feed is failing or stale"* and then names the three explicitly as a spend or entitlement decision — because §10's whole point is that those are not the same problem.

### Ask (§2) — a signature interface, not a chatbot

Ask was already the strongest room in the product. The changes are restraint, not reinvention.

- **Six suggestion chips → three**, led by the signature question: *"Show WWT pursuits over $500K renewing in 90 days without a verified economic buyer"* — four constraints, one line, the thing no CRM can answer.
- **Subtitle** now states what the room is for and what guarantees it: *"Ask a commercial question in plain language. Every answer is read from the governed record."*
- **History capped at four** with the remainder behind disclosure, so the page reads as a decision surface rather than a chat transcript.
- **UNKNOWN / AMBIGUOUS / UNSUPPORTED gained a next clause** — what a reader should do, not just what failed. Uncertainty stayed at full prominence; only provenance is progressive.

Verified in the captures: the unsupported question renders *"The question was understood. The record does not hold the answer — this is not a zero. Nothing was guessed."* at the same weight as a successful answer.

### Insights (§3) — a reading, not a scoreboard

**Was:** a wall of correct numbers with no reading. A four-deal win rate in the same weight of type as a rule; a calibration table that said "review" without saying what a reviewer would conclude; a source list showing "behind 2 won · 1 lost" with nothing about whether three deals mean anything.

**Now:** every block carries a **Reading** — *Suggests · Confidence · Strengthen*.

Confidence is a band derived from **sample size alone** and says so: `no sample yet` / `too thin to read` (<10) / `provisional` (<30) / `reasonable`. It is a statement about how much evidence exists, never a statistical claim about an effect. **Where the sample cannot carry a reading, the interpretation is withheld rather than offered** — an interpretation over four data points is worse than none. The withheld message names the actual unit and count, so four blocks on the same page do not read as one copy-pasted apology.

**An IA error was also corrected.** Conversation outcomes and source attribution — two *observed* measurements — sat underneath the **Declared assumptions** heading, which claimed the opposite of what they are. Both moved under **Observed outcomes**.

### Analytics (§4) — a purposeful empty state

**Was:** an empty BI graveyard — a timeframe selector and a stack of zero-value panels over a workspace that has sent nothing.

**Now:** *"Nothing to analyse yet."*, the reason, and the three questions the room will answer once sequences are running, plus one link into Campaigns. Every panel is gated on `hasData`, and after inspection the timeframe selector was gated too — a filter over nothing is an instrument with no reading.

Insights and Outreach analytics are now a **room pair** (`RoomTabs`), which is what they always were: the same question read from closed outcomes and from what was sent.

### Sources (§5) — trust as something earned

Subtitle: *"Where the evidence comes from, and how much each source has earned your trust."* The empty state got the Analytics treatment after inspection — it was one grey sentence floating on a blank page; it now states how a source registers itself and what the room will answer.

### Intake (§7) — the lifecycle leads, and so does the work

**Was:** an upload form, a grid of partner cards, a 25-row log. The one genuinely actionable state — a file read and waiting for a human to confirm its column mapping before anything is written — was a blue pill in the fourth column of the last table on the page.

**Now:** the lifecycle first, with org-wide counts (the log is capped at 25; a headline drawn from a capped list is a wrong number stated confidently). Anything **awaiting review** is named at the top with the file and a way into it. The upload form stays; its paragraph of explanation moved behind disclosure.

**On §7's vocabulary.** The brief asks for *received → normalized → matched → needs review → rejected*, "only where semantics support". **They do not fully, and I did not invent the difference.** A batch row is created only after the file has been parsed and its columns profiled (`staged.ts` inserts with `status='analyzed'`), so *received* and *normalized* are the same instant in this system and are shown as one stage. The states that are real — `analyzed` / `importing` / `imported` / `discarded` / `failed` — are named in the reader's language and nothing else is added.

**Two defects found by inspection.** The freshness badge was inverted: 20 days read `STALE` and 200 days read `AGING`, which is the milder-sounding of the two. It is now a worded, severity-ordered sentence. And a partner with mapped accounts but no file import rendered *"0 rows · 0% matched"* — stating a failure that never happened; that case now reads *"6 accounts mapped, none of them from a file imported here."*

### Contacts (§8) — six columns a seller decides on

**Was:** Contact · Company · Type · Email · Phone · Partner · Brand · Territory · Vertical · Segment · Location · Engagement.

**Now:** **Person · Role · Company · Relationship · Reach · Pursuits.**

Nothing was dropped. Coverage attributes moved to a quiet line under the person and appear only where the person has them. Reach is one answer instead of three columns — can we contact them, by what, and did anything come back. The Role column hides itself when the list is already grouped by type.

**Contact detail is new** (`/contacts/[id]`): the reach posture as a sentence, the relationship, **every** stakeholder assertion with its state and source (not just the strongest — the disagreement between two assertions is what a seller needs before a call), and the interaction history actually logged against the person.

**The honesty constraint that shaped the linking.** People discovered by intelligence on an account's public committee have no contact row. They are listed, because knowing they exist is useful — but they are **not linked**, and a disclosure says why. A detail page for a person the system cannot act on would be a fiction, and a dead link is worse than none.

### Admin (§6) — infrastructure leakage removed

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` were named on screen as the reason members could not be invited. That is a deployment fact stated to an operator who cannot act on it. It now reads *"Sign-in is not configured on this deployment."* Worker status moved to §10's vocabulary: **Not configured / Healthy / Degraded / Unavailable**.

---

## Cross-linking (§11) — verified against the running build, not the source

The evidence spine (`src/components/evidence-model.tsx`, new) renders on Intake, Sources, Provider health, Ask, Insights, Contacts and contact detail:

**INTAKE → SOURCES → FEED HEALTH → ASK → INSIGHTS → CONTACTS**

Every step routes to a page that exists; each room hands it its own counts; the component computes nothing.

A link crawl over the nine Wave 5 surfaces resolved **46 distinct targets — all 2xx.** Two findings came out of it:

1. **A dead link I had written, and removed.** The contact-detail stakeholder row linked an opportunity to `/pipeline?q=<name>`. `/pipeline` reads `view`, `timeframe` and scope — **it does not read `q`**. The link would have silently dropped the filter and dumped the reader on the whole board. The opportunity is now stated as text; the pursuit link beside it is the real destination. (It also surfaced itself physically: Next's RSC prefetch of that href hung the screenshot harness.)

2. **A link that can outlive its destination.** `stakeholders` carries no `org_id` of its own, so a stakeholder row survives a pursuit its reader cannot see. Both Contacts surfaces now take the pursuit id **from the joined `pursuits` row** rather than from `stakeholders.pursuit_id`, so a link is offered only where the destination is readable by this tenant; the detail page says *"Asserted against a pursuit outside your scope"* rather than either hiding the assertion or linking somewhere that will not open.

**On a 404 I diagnosed wrongly at first, and corrected.** Thirteen `/pursuits/<id>` links 404'd in the first crawl. My initial reading was RLS. It was not: `PURSUIT_EXPERIENCE_ENABLED` was unset in the stripped environment I built for screenshots, and `/pursuits/[id]` calls `notFound()` when the Pursuit Experience gate is off. With the gate enabled — matching the deployed configuration — **all thirteen resolve 200.** The comments in the code were rewritten to state the real reason for the join-based gating rather than the diagnosis I had disproved.

---

## Screenshot QA (§13) — generated **and inspected**

14 captures against the production build: Ask (default, successful result, unsupported), Insights, Analytics, Sources, Provider health, Intake, Contacts (collapsed and with the table open), contact detail, Admin, plus Ask and Analytics at 1280.

**All HTTP 200. Zero JS/console errors. Zero horizontal overflow at either width.** The spine truncates gracefully at 1280 rather than wrapping.

Repaired after inspection, before this report:

| Defect | Fix |
|---|---|
| Contacts headline said "5 of 5 can be reached… the rest carry no address" when there was no rest | branched copy for the all-reachable case |
| Contacts and contact detail showed the stored word `unknown` as engagement | "no reply yet" / "nothing received back yet" |
| Provider health headline called three unrunnable feeds "expected" | names them as a spend or entitlement decision |
| Intake partner card read "0 rows · 0% matched" for accounts that never came from a file | states the accounts figure and where they came from |
| Intake said "never imported here" three ways on one card | one statement |
| Analytics timeframe selector rendered over an empty room | gated on `hasData` |
| Sources empty state was one unstyled grey sentence | purposeful empty state |
| Insights repeated one withheld-interpretation sentence four times | the message names the actual unit and count |
| Insights calibration confidence read "0 closed deals" while the page headline said 8 | same denominator throughout |
| Insights claimed "every recorded win carries an attributable route" from the canonical-outcome subset only | scoped to what that subset sees |
| Contact detail opportunity linked to a query parameter Pipeline does not read | stated as text (see §11) |

---

## External-send verification (§14) — required record

| Check | Result |
|---|---|
| `RESEND_API_KEY` in this repository's local `.env.local` | **present** — the value is not reproduced here, was not printed, and was not changed |
| `OUTREACH_AUTOSEND` | **not present in `.env.local` and unset in the environment** — no automatic sending |
| `send.ts` when unconfigured | **fails closed** — throws before a provider is constructed and marks the message `failed` rather than silently succeeding |
| Deployment configuration changed in this wave | **no** |
| Credentials deleted or rotated in this wave | **no** |
| Deployed demo's credential state | **NOT VERIFIED FROM THIS ENVIRONMENT** |

**Stated plainly, as §14 requires.** `RESEND_API_KEY` exists in the local `.env.local`; demo runtime send behaviour remains fail-closed; **the deployed demo's credential state is not verified from this environment and must not be inferred from this box.** This is an explicit **Wave 6 deployment-certification gate**: if the certified demo must be provably incapable of sending, the deployment's `RESEND_API_KEY` has to be confirmed absent by someone who can read that environment.

Carried forward from Wave 4 and **not re-verified in this wave**: `campaign_touches` were 4 of 4 `draft`. Nothing in Wave 5 writes to that table, but the check itself was not repeated here.

---

## Tests (§15)

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` | clean |
| `visual-system-check` (12 rules, **361 files**) | clean |
| `npm test` (unit, 149 cases) | **149 passed, 0 failed** |
| Link crawl over the nine Wave 5 surfaces, against the running production build | **46 distinct targets, all 2xx** |
| Screenshot battery (14 captures, two widths) | all 200, no JS errors, no horizontal overflow |

### The DB-backed regression battery — what ran, and what could not

**Ran green earlier in this wave**, after the Provider health / Ask / Analytics / Admin / Sources passes and before the Insights / Intake / Contacts passes:

| Suite | Passed |
|---|---|
| disclosure · isolation · federation · scope · governed-mutation | 21 · 12 · 19 · 17 · 13 |
| outcomes · tenant-flags · outbox · observability · contributions · append-only | 18 · 13 · 20 · 13 · 12 · 11 |
| **interpret** (the Ask interpreter suite required by §15) | **255** |
| entity-resolution | 11 |
| **Total** | **435 passed, 0 failed** |

**Could not be re-run at the end of the wave.** The configured Postgres host became unreachable from this container partway through the final verification — `connect ETIMEDOUT 15.156.180.136:5432`, reproduced with a bare `pg` client. Every DB-backed verifier fails on connection, not on assertion. The local demo database is not a substitute: it does not carry the verifier fixtures and returns `ExecWithCheckOptions` / "missing fixtures" for most suites, which would be a meaningless green.

**So, precisely:** the suites above were green over roughly two-thirds of this wave's diff, and the remaining third — Insights, Intake, Contacts and contact detail — is covered by `tsc`, `next build`, the visual-system check, the unit suite, the link crawl and the inspected screenshot battery, but **not** by the DB-backed verifiers. Those three rooms add no writes and no policy; they change presentation and two read queries (both narrowing what is linked, never widening what is read). That bounds the risk; it does not discharge the check. **Re-running the battery is a Wave 6 entry condition.**

### Known pre-existing failures — signatures confirmed identical to Waves 2–4 (from this wave's earlier, connected run)

| Script | Signature | Unchanged? |
|---|---|---|
| `pursuit-verify` / `routes-verify` / `experience-verify` | `null value in column "slug" of relation "taxonomy_nodes"` | yes |
| `governance-verify` | `current transaction is aborted` (downstream of the same fixture failure) | yes |
| `facts-verify` | `routine: 'ExecConstraints'` — same fixture/schema-drift class | yes |

Not repaired in this wave, per §1 and §15.

---

## Deferred

- **Re-running the DB-backed regression battery** — blocked by the database host becoming unreachable from this container. **Wave 6 entry condition**, see §15.
- **`taxonomy_nodes.slug` fixture drift** — data-layer; out of scope for a presentation wave, and now four waves old. Worth its own task.
- **Deployed demo's send configuration** — see §14. Needs someone with access to the deployment's environment. **Wave 6 gate.**
- **Ask history rows pointing at pursuits** — the stored `record_hrefs` on old exchanges are raw ids with no readability check at render time. The same join-based gating applied to Contacts would apply here, but Ask's resolver contract is explicitly outside this wave's boundary.
- **Interaction history per contact** — the detail page renders `interaction_events`, which is empty in the demo world. The surface is correct; the data is not there yet.
- **Contact detail for discovered people** — deliberately absent, not deferred. It requires resolving a PDL person to a contact record, which is an entity-resolution decision, not a UI one.

---

## Success test

> *This is what came in. This is who it came from. This is whether those feeds can be trusted right now. This is what the record will answer when you ask it. This is what the outcomes have taught us, and how much of it the sample actually supports. And this is who, in the end, you have to reach.*

Six rooms that were six sidebar entries now read as one chain, and each one states its own confidence in words rather than leaving the reader to decode a status enum. The place the product was least honest — a health room that never said whether anything was healthy — was the first thing rewritten.
