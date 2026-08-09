# Pipeline worker on Railway

The autonomous intelligence loop (screening → escalation → deep research) runs
as a single long-lived **worker service** on Railway — deliberately NOT on
serverless, because deep research is minutes-long per account. The worker does
both jobs, reusing the same locked library:

- **HTTP trigger** — authenticated `POST /screen` and `POST /research`. A real
  Node process, so a full batch runs with **no timeout**.
- **Internal scheduler** — screening daily, research every few hours. A shared
  Postgres advisory lock keeps scheduled and on-demand runs from overlapping.

The Next.js web app stays where it is (e.g. Vercel); this worker is a separate
backend service that only talks to the database + provider APIs.

## Deploy

1. **New Railway project → Deploy from GitHub repo** → pick this repo.
   Railway reads `railway.json`: Nixpacks build, start command `npm run worker`,
   health check on `/health`.
2. **Set variables** (Service → Variables):

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Supabase connection string (URI, with password) |
   | `RESEARCH_TRIGGER_SECRET` | ✅ | Bearer secret for the HTTP triggers; unset = triggers closed (401) |
   | `ANTHROPIC_API_KEY` | ✅ | LLM extraction / classification |
   | `TAVILY_API_KEY` | ✅ | deep-research investigator |
   | `PDL_API_KEY` | ✅ | firmographics + people |
   | `IPINFO_TOKEN`, `CENSYS_PAT`, `CENSYS_ORG_ID`, `BUILTWITH_API_KEY` | optional | providers skip gracefully without them |
   | `WORKER_CRON` | optional | `off` disables the internal scheduler (default on) |
   | `SCREEN_HOUR_UTC` | optional | daily screening hour, UTC (default `7`) |
   | `RESEARCH_INTERVAL_HOURS` | optional | research cadence (default `6`) |
   | `SWEEP_LIMIT` / `RESEARCH_LIMIT` | optional | accounts/jobs per run (default `25`) |

   `PORT` is injected by Railway — don't set it.
3. Deploy. `GET /health` should return `{"status":"ok"}`.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Railway health check |
| GET | `/status` | bearer | research-queue counts |
| POST | `/screen?limit=N` | bearer | screen the portfolio now (fills the queue) |
| POST | `/research?limit=N` | bearer | drain the deep-research queue now |

Auth: `Authorization: Bearer $RESEARCH_TRIGGER_SECRET` (or `?key=`). Overlapping
runs return **409** (the advisory lock is held).

```bash
# drain the queue on demand
curl -X POST -H "Authorization: Bearer $RESEARCH_TRIGGER_SECRET" \
  "https://<worker-domain>/research?limit=25"
```

## Scheduler

With `WORKER_CRON=on` (default), a 60-second ticker runs:
- **research** every `RESEARCH_INTERVAL_HOURS` (first fire one interval after boot),
- **screening** once/day at `SCREEN_HOUR_UTC`.

Both go through the shared advisory lock, so a manual trigger and a scheduled
run can never overlap.

## Alternative: Railway native cron services

If you'd rather use Railway's built-in cron instead of the internal scheduler,
set `WORKER_CRON=off` on the worker (keep it for the HTTP triggers) and add two
cron services from the same repo:

- start `npm run screen` — cron `0 7 * * *`
- start `npm run research` — cron `0 */6 * * *`

Same env vars. Railway skips a cron tick if the previous run is still going, and
the advisory lock is the backstop.
