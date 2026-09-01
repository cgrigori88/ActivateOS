#!/usr/bin/env python3
"""
Apply supabase/migrations/*.sql over the Supabase Management API.

Why this exists: scripts/migrate.ts connects with `pg` over TCP 5432, which this
container's egress blocks. HTTPS to api.supabase.com works, and the Management
API exposes a SQL endpoint, so the same ordered, tracked migration run is
possible without a direct database connection.

Same contract as migrate.ts: ordered by filename, tracked in schema_migrations,
skips what is already applied, stops on the first failure and names the file.
"""
import json, os, sys, time, urllib.request, urllib.error, pathlib

REF = os.environ["SUPABASE_TARGET_REF"]
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
DRY = "--dry-run" in sys.argv


def run_sql(sql: str, read_only: bool = False):
    body = json.dumps({"query": sql, "read_only": read_only}).encode()
    req = urllib.request.Request(
        URL, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            # Cloudflare in front of the Management API rejects urllib's default
            # agent with a 1010 block, so identify this client explicitly.
            "User-Agent": "pursuitos-migrate/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {detail[:600]}") from None


run_sql("""create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
)""")

applied = {r["filename"] for r in (run_sql("select filename from schema_migrations", True) or [])}

files = sorted(p for p in pathlib.Path("supabase/migrations").glob("*.sql"))
print(f"target      : {REF}")
print(f"on disk     : {len(files)}")
print(f"already applied: {len(applied)}\n")

n_applied = n_skipped = 0
for f in files:
    if f.name in applied:
        n_skipped += 1
        continue
    if DRY:
        print(f"  would apply {f.name}")
        n_applied += 1
        continue
    sql = f.read_text()
    try:
        run_sql(sql)
    except RuntimeError as e:
        print(f"\nFAILED on {f.name}\n{e}")
        sys.exit(1)
    # Stamped only after the file actually succeeded, so a crash mid-run leaves
    # the tracker honest rather than claiming work that did not happen.
    run_sql("insert into schema_migrations (filename) values (%s) on conflict do nothing"
            .replace("%s", "'" + f.name.replace("'", "''") + "'"))
    n_applied += 1
    print(f"  applied {f.name}")
    time.sleep(0.12)  # stay well under the Management API rate limit

print(f"\n{'would apply' if DRY else 'applied'} {n_applied}, skipped {n_skipped}")
