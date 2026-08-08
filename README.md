# ActivateOS

**The AI decision and orchestration layer for partner-led revenue.**
ActivateOS decides what the channel should do next.

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
export DATABASE_URL=postgres://...       # Supabase or local Postgres (needs pgvector)
npm run db:migrate                       # apply supabase/migrations/*.sql
npm run db:seed                          # seed ontology + play templates
npm run ingest -- samples/accounts.sample.csv "My Org"
npm test
npm run dev
```

## Engineering principles (short form)

1. The LLM is never the propensity model — deterministic, explainable scoring first.
2. Every recommendation answers WHY; no scored signal without an evidence row.
3. Signals decay; negative signals reduce scores.
4. Every commercial interaction emits an immutable outcome event.
5. Measure lift, not eloquence.
6. Human-approved sends; agents propose, people dispose.
7. Boring stack, modular monolith.

See [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) §4 for the full, binding list.
