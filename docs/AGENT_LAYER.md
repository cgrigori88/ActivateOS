# The PursuitOS Agent Layer

The agent layer is the reasoning brain of Design and Execute: it turns scored
opportunities into Revenue Motions, campaigns, and seller actions. It is **not**
one general-purpose agent. It is a set of narrow, constrained agent workflows,
each grounded in a curated knowledge base and gated by hard rules about what
data it may see and what it may assert.

## Why constrained, not free-form

A general agent asked to "design the campaign" will hallucinate market facts,
blend tenants' data, and produce unauditable output. The founding principle
(see PROJECT_BRIEF §4) is that every recommendation answers WHY with evidence.
The agent layer inherits that: an agent is a function from *(evidence-backed
inputs + curated knowledge)* to *(schema-validated output + citations)*, never
a conversation with model priors.

## 1. The Channel Knowledge Base (what the agents are "learned on")

Three curated, versioned stores encode founder judgment. Agents retrieve from
these; they do not rely on what the base model happens to believe about the
channel.

| Store | Contents | Source of truth |
|---|---|---|
| **Activate Technology Ontology** | Categories, adjacency / complementary / replacement edges | `knowledge/ontology/` → `taxonomy_nodes`, `taxonomy_edges` |
| **Solution Profiles** | Per solution-category: buyer personas, value drivers, competitive conditions, qualification criteria, typical economics | `knowledge/solutions/` |
| **Play Library** | Motion templates: trigger signals, thesis template, personas, CTA/offer, seller cadence, objection patterns, negative/disqualifying signals | `knowledge/plays/` → `play_templates` |

Rules for the knowledge base:

- **Human-curated, version-controlled.** Every entry is reviewed by the
  commercial founder before agents may use it. Edits go through git like code.
- **Category-first.** Knowledge is written at the solution-category level
  (e.g. "infrastructure automation"), vendor-agnostic, so it transfers across
  design partners and contains nothing proprietary to any vendor.
- **Learned over time, not retrained.** Outcome events (meetings, opportunities,
  wins/losses per play) accumulate as per-play performance stats that agents see
  as context ("this play converts at X in segment Y") and that we use to
  reweight, retire, or fork plays. No model fine-tuning in year one.

## 2. Grounding rules ("plays cleanly in the data it's fed")

1. **Evidence-gated context.** An agent's prompt may only contain account facts
   that exist as `evidence` rows (source, claim, confidence, observed_at).
   Raw scraped text never goes straight into a decision prompt — it goes through
   the extraction workflow first, which produces evidence rows.
2. **Citations required.** Every claim in an agent's output must reference the
   evidence ids or knowledge-base entries it used. Output that asserts an
   uncited fact is rejected and regenerated.
3. **Schema-constrained output.** Every workflow has a typed output schema
   (zod). Free text exists only inside designated fields (e.g. thesis prose).
4. **Tenant isolation.** Agent context is assembled per organization. No
   cross-tenant data ever enters a prompt. Customer data is never used to
   train models.
5. **No invented numbers.** Agents may not produce probabilities, market sizes,
   or ROI figures. Scores come from the deterministic Predict engine; economic
   figures come from solution-profile ranges or customer-supplied data, cited.
6. **Approval gates.** Nothing customer-facing (emails, campaigns, motion
   launches) executes without human approval in V1. Agents propose; people
   dispose.
7. **Full decision log.** Every agent run records: workflow id + version,
   prompt/knowledge versions, input evidence ids, model + parameters, raw
   output, validation result, human decision. This is both the audit trail and
   future training data.

## 3. The workflows (V1)

Each is a small, single-purpose pipeline: structured inputs → task-specific
prompt + retrieval → schema-validated output → human review.

| Workflow | Input | Output |
|---|---|---|
| **Extractor** | Raw research text (web, filings, job posts) | `evidence` rows with confidence |
| **Taxonomy Mapper** | Evidence rows | Signals linked to ontology nodes |
| **Motion Designer** | Scored account×solution×partner + matching play template + evidence | Draft `revenue_motion` (thesis, personas, trigger, CTA) with citations |
| **Campaign Composer** | Approved motion + solution profile | Seller playbook, outreach drafts, discovery guide |
| **Account Personalizer** | Motion + per-account evidence | Account-specific reason-to-engage + message variant |
| **Response Classifier** | Inbound reply text | Classified outcome event (positive/negative/objection/meeting) |
| **QA Reviewer** | Any draft output | Rule-based + model critique against play standards before human review |

Model routing per PROJECT_BRIEF §5: cheap tier for Extractor, Taxonomy Mapper,
Response Classifier; frontier tier for Motion Designer and Campaign Composer.

## 4. The learning loop

```text
play_template (versioned)
      ↓
motion designed → approved/edited/rejected   ← human feedback captured
      ↓
campaign executed → outcome events
      ↓
per-play, per-segment performance stats
      ↓
founder reviews → reweight / revise / retire plays
      ↓
updated play_template version
```

Human edits are signal: when the founder rewrites an agent's thesis, the diff
is stored against the workflow version. Recurring edits become prompt or
knowledge-base fixes — that is how the agent layer "learns thoroughly" without
uncontrolled drift.

## 5. Seeding order

Seed the knowledge base in the same order as scoring (PROJECT_BRIEF §8):

1. **Infrastructure automation / modernization** — first ontology branch,
   first solution profile, first play (`infrastructure-automation-modernization`).
2. Cybersecurity / compliance — fast-follow to prove the layer generalizes.
3. Cloud / infrastructure cost optimization.
