# TD SYNNEX Pre-Demo Certification

**Demo commit: `03ae85b`** on `claude/activateos-platform-review-xzkgmd`. The SHA is the
authoritative freeze identifier: an annotated `tdsynnex-demo` tag exists locally but the remote
refuses tag refs for this session's credentials (HTTP 403), so do not rely on the tag being there —
push it from a workstation with tag permission if you want one, or just use the SHA.

`03ae85b` differs from `6cd727a` — the commit the certification walk actually ran against — only in
this document, so the running application is identical.
Certified against a production build (`npm run build` → `npx next start`) on demo state rebuilt
from source. **18/18 rooms PASS.**

---

## 1. Live P2C-1 validation — NOT RUN

**A model credential is not available in this environment.** Three sources were checked:

| Source | Result |
|---|---|
| `ANTHROPIC_API_KEY` in `.env.local` | present, **returns 401 `authentication_error`** |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the environment | not set |
| Per-tenant BYO-model key (`org_ai_settings.anthropic_key_enc`) | none configured |

No secret was printed, logged or committed at any point.

**Consequence, stated plainly: the interpreter's semantic quality remains unverified.** Whether a
real model picks the right intent for a real paraphrase is the one thing this release still cannot
claim. Everything structural is verified — 255 assertions drive the contract through the production
provider seam with adversarial and malformed outputs — but that proves the *contract*, not the
*model*.

**The fallback was not weakened.** Verified end to end against the real 401:

- an unavailable model becomes `REJECTED` in ~1 ms and the deterministic answer stands;
- all 12 demo questions resolve on the **deterministic path with no model at all**;
- `INTERPRETER_ENABLED=off` changes nothing about deterministic coverage.

**`scripts/interpret-live-validate.ts` is committed and ready.** One command runs the full §1 matrix
— deterministic paraphrase, model-required paraphrase, ambiguous, unsupported, compound, Value Case,
lifecycle, stakeholder — asserting `query → intentKey + slots → validation → deterministic resolver
→ answer` at each step and reporting interpretation accuracy plus interpreter / resolver / total
latency separately. It exits 2 with a clear message when no credential is present:

```
set -a; . ./.env.local; set +a
DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo \
  npx tsx scripts/interpret-live-validate.ts
```

It also checks the §1 ordering claim rather than assuming it: a case marked deterministic **fails**
if the model was consulted.

---

## 2. Ask UX changes

Nothing was deleted. Engineering provenance moved one click away; commercial meaning moved up.

**Default reading order** — answer · what is at stake · supporting records · next useful action.
**Behind "Why this answer"** — intent key, resolution path, validated slots, scope size, record deep
links, interpret/resolve/total latency, discarded interpretations, catalog fingerprint, timestamp.

**Two things are never softened:**

- **Uncertainty is not hidden.** UNKNOWN / AMBIGUOUS / UNSUPPORTED render as prominently as a
  successful answer, with their meaning in words — *"The question was understood. The record does
  not hold the answer — this is not a zero."* Progressive disclosure applies to provenance, never
  to doubt.
- **An absent figure stays absent.** Four resolvers supply no commercial figure on purpose, and the
  block is simply not rendered: the change ledger carries materiality not amounts; the decision
  queue carries priority bands not amounts; partner activation is counts and outcomes with no
  honest way to collapse them into one number; a route explanation has no total.

**Significance is computed by the resolver** from the rows it just returned, and carries a mandatory
`basis` sentence. Two cases where the choice of figure is itself the honesty:

- **Contested economics report the DEAL amount**, and the basis says the disputed customer-impact
  figures were *not* summed. Summing numbers that contradict each other is averaging a conflict by
  another route (P2B §17).
- **Defensible modeled impact reports the FLOOR** (the low bound), not a midpoint or ceiling, and
  says so.

**Result hierarchy** — the latest answer is the hero card; earlier questions collapse to one-line
history rows carrying outcome, question, significance and date, expanding in place with the
identical layout. Simple by default, complete on demand.

### The unapplied-clause notice — the substantive addition

The TD SYNNEX example question, **"Show me high-value Pursuits renewing in the next 90 days that are
blocked by a partner or missing buying authority"**, is **not truthfully supported**, and testing it
exposed a real defect rather than a missing feature.

The compound parser declines it (there is no partner-blocked filter, "buying authority" is not one
of the three canonical roles, and compound is a conjunction not the "or" the sentence asks for).
Routing then fell through to `lifecycle.horizon`, which answered the renewal clause perfectly and
**dropped the other two clauses in silence** — returning a broader set than was asked for, under a
read-back that never mentioned what it ignored. Same failure shape as a dropped amount filter,
arriving by a different route.

The fix is not to invent the capability. An answer now names the clauses it could not apply, in
amber, **above the outcome and outside any disclosure**:

> This answer does not apply the buying-authority constraint or the partner-blocked condition.
> PursuitOS cannot represent those constraints in one query yet, so they were left out rather than
> silently assumed.

Per the brief's instruction, **the demo does not use that question as its closer.** It closes on the
four-constraint query the registry answers in full. The unsupported one stays in Ask history, one
click away, because a distributor executive asking "what happens when it *can't*?" is the best
question we can be asked.

---

## 3. The 8-minute executive path

**Navigate with ⌘K, not the rail.** At demo resolutions the 16-item rail overflows and Pipeline sits
below a scroll fade; ⌘K is faster, always visible, and demonstrates the query layer for free.

| # | Page | Click | Hero record | The point, in one sentence | Expected state | If it fails |
|---|---|---|---|---|---|---|
| 1 | `/` Today | — | the decision queue | "This is the day, ordered by materiality — not by what happened most recently." | Decision cards with class chips; DECISION_REQUIRED at top | Reload; if empty, go to `/pipeline` and open the top pursuit |
| 2 | `/motions` → **Constraints** | Constraints tab | Virtualization | "Across many accounts, this is exactly where the motion is stuck — and what it's worth." | **$6.9M currently constrained**; blockers ranked; *informational — never gates* separated below | Stay on Overview and read the funnel counts |
| 3 | `/partners/45aaba63…` | ⌘K → "CDW" | **CDW** | "Presence is a list truth. Activation is behaviour. They are allowed to disagree." | Activation profile banner; observed pattern per category with sufficiency flags | Use WWT (`9c533551…`) — sparser, same story |
| 4 | `/pursuits/8ef34823…` | ⌘K → "Globex Manufacturing" | **Globex Manufacturing Inc.** — *Exit legacy virtualization before renewal* | "One governed Pursuit: intent, evidence, route, team, execution — with the recommendation preserved beside the human decision." | WHY NOW; **Recommended CDW / Selected WWT — human override**; the override is on the record | Skip to `#value` |
| 5 | same page, *Why WWT* card | **Partner view** toggle | the confidential activity figure | "Same Pursuit, two audiences. The confidential figure is absent from the partner's payload — verify it on the partner's own surface, where it was never serialized." | Sponsor view shows a `CONFIDENTIAL` badge; Partner view shows *"1 confidential figure removed at the server"* | Open `/partners/9c533551…/review` and search the page for the figure — it is not there |
| 6 | `#value` | scroll / anchor | Globex Value Case | "Three economic truths, kept separate: what we book, what we expect, what the customer gains." | Deal $920k · Expected $1.3M · **Modeled customer impact $850k–$1.2M**; *what would strengthen this* | Use Umbrella (`a7f7dfb5…#value`) — CONFLICTING |
| 7 | `/pipeline` | ⌘K → "Pipeline" | attention view | "Now the same discipline across the whole ecosystem." | Renewal radar, attention cuts, filter chips | `?view=portfolio` |
| 8 | `/ask` | ⌘K → "Ask" | the hero card | "Ask it in English. A model reads the question; it never sees a record and never writes the answer." | **"Show WWT pursuits over $500K renewing in 90 days without a verified economic buyer"** → 3 pursuits, **$2.9M**, all four constraints applied, *none dropped* | Read the pinned suggestion chips instead |

**Close on step 8.** Expand *Why this answer* for one beat: intent `pursuit.compound`, parsed
deterministically, no model consulted, 3 records read.

---

## 4. The 12-minute product path

Steps 1–8 above, with these inserted:

| After | # | Page | Click | Hero record | The point | Expected state | If it fails |
|---|---|---|---|---|---|---|---|
| 4 | 4b | `#team` | anchor | Globex pursuit team | "Execution is multi-party. This is who has to move, and who hasn't." | Team roles with accept/confirm state; the readiness gate named | Read the readiness chip in the header |
| 5 | 5b | `#stakeholders` | anchor | Globex buying committee | "Who are we missing? A title is context, never authority." | **Economic buyer: missing** — $1.3M in play; verified champion and technical buyer named; warm path with its evidence tier | `/pursuits/…#stakeholders` direct |
| 6 | 6b | `a7f7dfb5…#value` | ⌘K → "Umbrella" | **Umbrella Health Systems** | "Finance says $1.8M. Infrastructure says $2.4M. We show both and choose neither." | CONFLICTING state; both figures; no average anywhere | Ask: *"Which value cases contain conflicting economic facts?"* |
| 6b | 6c | `#whynow` | anchor | Globex renewal | "Why now — and how well do we actually know?" | Renewal **verified 2026-11-15**, 76 days; the fact behind it with provenance | `/pipeline` renewal radar |
| 7 | 7b | `#brief` | anchor | Globex brief | "The same truth, assembled for a human: what we know, what we can't claim, what to ask." | BUSINESS VALUE section; *what we can't claim* populated | Skip |
| 7 | 7c | `/insights` | ⌘K → "Insights" | outcome learning | "And it learns from outcomes — but only where the sample supports a conclusion." | Funnel, calibration, *insufficient evidence* where n is small | Skip |
| 8 | 8b | `/ask` history | expand the OR question | the unapplied notice | "And when it *can't* represent your question, it says which part it dropped." | Amber notice naming the buying-authority and partner-blocked clauses | Read the notice from this document |

---

## 5. PASS / FAIL per step

Mechanical certification — `scripts/demo-certify.mjs`, production build, clean demo state. Each room
checked for HTTP status, rendered content, expected substance, dead in-app links, console errors,
scroll height, debug artifacts, and (on partner-facing surfaces) the sponsor-confidential figure.

| Step | Route | Result | Height |
|---|---|---|---|
| 1 Today | `/` | **PASS** | 2247px |
| 2a Motion Overview | `/motions` | **PASS** | fits |
| 2b Motion Constraints | `/motions?view=constraints` | **PASS** | fits |
| 3 Partner Activation | `/partners/{id}` | **PASS** | 1077px |
| 4 Pursuit Detail | `/pursuits/{id}` | **PASS** | 4542px (anchored) |
| 5 Partner review (disclosure) | `/partners/{id}/review` | **PASS** — no confidential figure | fits |
| 5b Second partner review | `/partners/{id2}/review` | **PASS** — no confidential figure | fits |
| 6 Execution plan | `#team` | **PASS** | 4542px (anchored) |
| 7 Stakeholder Intelligence | `#stakeholders` | **PASS** | 4542px (anchored) |
| 8 Value Case | `#value` | **PASS** | 4542px (anchored) |
| 8b Value Case (conflict) | Umbrella `#value` | **PASS** | 3972px (anchored) |
| 9 Lifecycle | `#whynow` | **PASS** | 4542px (anchored) |
| 10a Pipeline Attention | `/pipeline` | **PASS** | 2661px |
| 10b Pipeline Portfolio | `/pipeline?view=portfolio` | **PASS** | 1431px |
| 11 Ask | `/ask` | **PASS** | 1234px |
| 12 Insights | `/insights` | **PASS** | 2203px |
| — Brief | `#brief` | **PASS** | 4542px (anchored) |
| — Accounts | `/accounts/{id}` | **PASS** | 1880px |

**18/18.** No 404s. No dead links. No console errors. No confidential figure on any partner-facing
surface. No debug artifact in a customer view. Machine-readable results:
`audit/intel-wave-screens/tdsynnex/certification.json`.

**Cross-room reconciliation spot-checked:** Motion Constraints reports **$6.9M currently
constrained**; Ask's *"Where is revenue blocked?"* and *"Which motion has the most constrained
revenue?"* both report **$6.9M** from the same aggregate.

---

## 6. Regressions discovered and fixed

1. **`/admin` returned HTTP 500** on any deployment whose database has no readable `auth` schema —
   `permission denied for schema auth`, from a link present in the rail on **every page**. One
   unavailable panel was taking a whole room down. The member list now degrades to a stated notice
   and the room renders everything else.
2. **A change-ledger entry with no pursuit or account behind it linked to `/today`** — a 404. Today
   lives at the root.
3. **The certification walk measured `document.body.scrollHeight`**, which an inner scroll container
   pins at viewport height — silently passing a long room as short. Now measures
   `documentElement.scrollHeight`, and rooms the journey enters by anchor get a higher limit
   because the demo deep-links into them rather than scrolling.
4. **A false-positive leak check.** Scanning every page for the formatted `$1.84M` reported a leak
   on the Globex pursuit — which was *"$1.84M recent category activity through TD SYNNEX"*, a
   different account and a different number that rounds the same way. A leak test that fires on
   coincidence trains you to ignore it. Now the exact digits, on partner-facing surfaces only.
5. **The disclosure caption overclaimed.** *"absent from this payload, not hidden in the browser"*
   is true of the partner's payload, but the sponsor's page legitimately contains both payloads —
   so a skeptic who views source finds the string and concludes we bluffed. The caption now says
   where the claim can be verified independently, and the sponsor view states why both are present.
6. **The Ask hero was the unsupported question**, purely because it was last in the demo seed. The
   demo's final impression should be the capability, not its edge; reordered.

---

## 7. Known caveats and fallbacks

| Caveat | Mitigation on the day |
|---|---|
| **Live model interpretation is unverified.** No working credential. | Every demo question resolves deterministically with no model. If asked: say so directly — the deterministic tier is the product, the interpreter widens reach, and the validation harness runs the moment a key exists. |
| **The rail overflows at demo resolutions**; Pipeline sits below a scroll fade. | Navigate with ⌘K throughout. Both paths above already do. |
| **Pursuit Detail is ~4,500px.** | Enter by anchor (`#value`, `#stakeholders`, `#whynow`, `#team`), never by scrolling. Restructuring the room is post-demo work. |
| **WWT's scorecard is mostly `$0`** (no settled joint deals). | Use **CDW** as the step-3 hero — it has real activation and outcomes. WWT is the *contrast* ("presence without activation"), which is on-message. |
| **The brief's example Ask question is not truthfully supported.** | Do not ask it as the closer. It is in Ask history and makes an excellent answer to "what happens when it can't?" |
| **Some partner cells read "insufficient evidence".** | This is the thesis, not a gap: the product refuses to rank on a sample that cannot support a conclusion. |
| **Five verify suites need a `wsb_verify` database** that does not exist here. | Pre-existing and unrelated — proven by `git stash` reproducing identical failures on the unmodified tree. |

**Reset procedure** (if demo state is disturbed):

```
export DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo
for s in demo-db demo-stories demo-intel-story backfill-motion-pursuits \
         demo-stakeholder-story demo-lifecycle-story demo-value-story demo-ask-story; do
  npx tsx scripts/$s.ts; done
```

Running the verify battery **mutates demo state** (it selected a route partner during this pass) —
rebuild from source before the walkthrough, not after.

---

## 8. Test status

| | |
|---|---|
| Unit tests | **130 / 130** |
| Verify suites | **28 green · 871 assertions** |
| P2C-1 interpreter suite | **255 assertions** (was 190; +65 this pass) |
| Demo certification | **18 / 18 rooms** |
| Production build | clean |

---

## 9. Screenshots

`audit/intel-wave-screens/tdsynnex/` — one full-page capture per journey step, production build,
clean demo state. `audit/intel-wave-screens/p2c1/` — Ask room, desktop and mobile, light and dark.

---

## 10. Post-demo roadmap — **documented, not implemented**

Nothing below is built. Grouped by what each unlocks.

### Near-term product

| Capability | Why it comes next |
|---|---|
| **Canonical Pursuit creation** | Pursuits are detected and backfilled today; an operator cannot originate one in the governed model. |
| **Governed external execution** | The skill registry has the effect class and the approval gate; nothing is authorized to send. |
| **Executive reporting** | Insights answers "did it work". A distributor exec also needs "what do I tell my board". |
| **MDF / investment intelligence** | The partner activation profile is the substrate: which co-investment actually changed activation. |
| **Scenario / intervention testing** | "If we verified this economic driver, what moves?" — the sensitivity model exists; the what-if surface does not. |
| **Partner benchmarking** | Per-partner outcomes exist; comparison needs calibration floors that survive small samples. |
| **Customer-ready Value Case** | Boundary designed in P2B §18. Deliberately still not built: an artifact that leaves the building needs a different disclosure contract. |

### Pilot integration

CRM / PRM · distributor data feeds · interaction, calendar and email signals · real tenant
onboarding and federation · production telemetry and commissioning · SSO / SCIM where required.

### Network / platform

Ecosystem benchmarking · marketplace / network layer · transaction and settlement layer.

---

## 11. Freeze

**Demo commit: `03ae85b`.** No further feature work before the walkthrough.

To reproduce exactly:

```
git checkout 03ae85b
# rebuild demo state (see §7), then:
mv .env.local .env.local.aside          # NEXT_PUBLIC_SUPABASE_* is inlined at build time
npm run build
DATABASE_URL=postgresql://app_rw:demo@127.0.0.1:5433/pursuit_demo \
PURSUITS_ENABLED=on FACTS_ENABLED=on ROUTING_ENABLED=on PURSUIT_EXPERIENCE_ENABLED=on \
FEDERATION_ENABLED=on GOVERNED_ACTION_ENABLED=on OUTCOME_LEARNING_ENABLED=on \
INTERPRETER_ENABLED=on npx next start -p 3100
```

Hero record ids for this demo state:

| | |
|---|---|
| Globex pursuit | `8ef34823-b00d-4a69-b8c4-9b24920bdff4` |
| Globex account | `77595ada-0ce9-434c-9eef-fa7a5ade3068` |
| Umbrella pursuit (conflict) | `a7f7dfb5-b91f-4e2f-9961-57b16358916c` |
| CDW (step 3 hero) | `45aaba63-c63e-41e7-a241-1cf6fb11407d` |
| WWT (contrast) | `9c533551-83d0-4f71-a539-3bed59f3b920` |

Ids are regenerated by a demo rebuild — re-read them with the query in §7 if you reset.
