# PursuitOS

**PursuitOS** (formerly ActivateOS — renamed after securing pursuitos.io / pursuitos.xyz).

**The AI decision and orchestration layer for partner-led revenue.**
PursuitOS decides what the channel should do next.

- [Project brief & founding technical direction](docs/PROJECT_BRIEF.md)
- [Agent layer design](docs/AGENT_LAYER.md)

## Layout

```
docs/                 Founding brief and design docs
knowledge/            Channel Knowledge Base (ontology, solution profiles, plays)
supabase/migrations/  Database schema
src/                  Next.js app + libraries (identity, ingestion)
scripts/              migrate / seed / ingest CLIs
samples/              Sample account CSV
tests/                Unit tests (node:test)
```

## Getting started

```bash
npm install
cp .env.example .env.local               # fill in DATABASE_URL (Supabase pooler)
npm run db:migrate                       # apply supabase/migrations/*.sql
npm run db:seed                          # seed ontology + play templates
npm run ingest -- samples/accounts.sample.csv "My Org"
npm run map-signals -- "My Org"          # deterministic; add --llm for model classification
npm run score -- "My Org" infrastructure-automation
npm test
npm run dev                              # ranked accounts + WHY NOW panel
```

### Credentials

- **Anthropic (agents):** preferred is your Claude subscription — run `ant auth login`
  once; the SDK picks up the stored profile with no env var. Alternatives:
  `ANTHROPIC_AUTH_TOKEN` (from `ant auth print-credentials --env`) or an
  `ANTHROPIC_API_KEY`. Deterministic pipelines (ingest, map-signals, score) need
  no Anthropic credentials at all.
- **Database:** any Postgres with pgvector. For Supabase, use the session-pooler
  connection string (IPv4). From environments that block raw Postgres traffic,
  apply SQL over HTTPS instead: `npm run db:seed-sql` regenerates
  `supabase/seed/0001_knowledge.sql`, then
  `npm run db:remote -- supabase/migrations/*.sql supabase/seed/*.sql`
  (needs `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN`).

## Engineering principles (short form)

1. The LLM is never the propensity model — deterministic, explainable scoring first.
2. Every recommendation answers WHY; no scored signal without an evidence row.
3. Signals decay; negative signals reduce scores.
4. Every commercial interaction emits an immutable outcome event.
5. Measure lift, not eloquence.
6. Human-approved sends; agents propose, people dispose.
7. Boring stack, modular monolith.

See [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) §4 for the full, binding list.
