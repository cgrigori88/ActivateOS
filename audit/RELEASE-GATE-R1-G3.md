# Release Gate R1-G3 — Runtime cross-tenant isolation proof (verification)

**Goal (approved D4):** owner/service bypass is a privileged infrastructure mechanism, never the tenancy model. Remove caller-controlled tenant selection; apply FORCE RLS where compatible; prove caller-controlled IDs cannot cross the tenant boundary; consent/participant withdrawal behaves correctly.

## Delivered
- `supabase/migrations/0090_force_rls.sql` — `FORCE ROW LEVEL SECURITY` on every table that already has RLS enabled (150 tables). RLS already binds the non-owner app role; FORCE additionally binds the **table owner**, closing the "app role becomes owner / mis-scoped policy" gap. Compatible with the D4 model: the owner pool the worker/webhooks/research use is a BYPASSRLS/superuser role (`postgres`), for which FORCE is a no-op — so the documented cross-tenant system jobs keep working. If that pool is ever repointed at a non-BYPASSRLS role, those jobs must first set an explicit per-org `app.org_id` (the surfaces the negative suite covers).
- `src/app/api/research/route.ts` — the owner-pool research trigger no longer trusts a raw `orgId` query param: a supplied `orgId` must be a **well-formed UUID of a real org** or the request is rejected (400 invalid / 404 unknown) instead of silently switching context to any id a secret-holder names.
- `scripts/isolation-verify.ts` — the consolidated two-tenant negative suite.

## Blind harness — 12 / 12 (as app_rw under FORCE RLS, org A naming org B's ids)
- **No crossing by naming an id:** org A sees zero rows for B's pursuit; the participant and outcome read models return **nothing** for a foreign pursuit.
- **No governed mutation across tenants:** a governed `accept_participation` on B's participant does not EXECUTE for org A, and B's participant is unchanged.
- **Recompute cannot be aimed across tenants:** draining A's recompute queue creates **no** route snapshot on B's pursuit (RLS hides B's data from A's drain).
- **Feature flags tenant-isolated:** A cannot read B's `org_features` row, and A cannot write a flag onto org B (RLS with-check refuses).
- **Consent + participant withdrawal:** once B makes A an ACTIVE participant + ACTION grant, A can see B's pursuit and holds authority; **revoking the grant** removes A's action authority and **revoking participation** removes A's visibility.

## Real booted-app verification
`/api/research` under the owner pool + trigger secret: `orgId=not-a-uuid` → **400**, an unknown UUID → **404**, the real org → **200**, a wrong secret → **401**.

## Gate
tsc **clean** · migration **90 applied** (FORCE RLS on 150 tables; owner-pool paths documented + compatible; **no destructive statements**) · caller-controlled tenant selection removed from `/api/research` · two-tenant negative suite **12/12** · consent/withdrawal proven · regression G1 **13/13**, G2 **13/13**, E3-A…E3-H **134/134**.

## Owner-pool paths — status (per D4)
| Surface | Isolation basis | R1-G3 status |
|---|---|---|
| `/api/research` | shared secret + **validated** org id | FIXED — no caller-controlled tenant switch |
| Worker (screening/research/outreach/backup) | app-layer `where org_id` loops; owner is BYPASSRLS | documented; genuinely cross-tenant system job. Outreach send governance → G4 |
| `/api/webhooks/resend` | svix signature; org resolved from the message row (not a caller id) | documented; org derived from signed payload, not a caller param |
| Provisioning (login/join/admin) | bootstrap — no caller-org exists yet; `requireOwner` + explicit filters | documented; expected owner path |

The RLS-backed **data** boundary (participant reads, governed actions, recompute, outcomes, flags) is proven closed. The owner-pool **system** paths keep app-layer scoping and a BYPASSRLS owner by design; FORCE RLS is their floor if the owner role is ever downgraded.

## Deferred to later gates (by design)
- Two real-authed-user (not single-role SQL) blind test — needs a second seeded auth user; covered by the G8 three-org pilot scenario booted through the authenticated app.
- HTTP-payload disclosure-absence probe at the served boundary → folded into G8's authenticated run (the read-model layer is proven here; the served-payload assertion rides the booted scenario).
- Outreach-send governance through the outbox → G4.

**R1-G3 complete (third and final release-blocker gate). Proceeding to R1-G4 (governed-action robustness).**
