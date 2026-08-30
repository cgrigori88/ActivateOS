# Release Gate R1-G1 — Single mutation authority (verification)

**Goal (approved D1):** `dispatchSkill` is the single governed authority for any persistent mutation that alters shared commercial state or causes a cross-tenant/external effect. No autonomous cross-tenant mutation path is exposed to the BYO LLM. `request_warm_intro` moves behind `dispatchSkill`.

## Delivered
- `supabase/migrations/0088_api_key_scope.sql` — `api_keys.scope` (`read`/`write`, default `write`); `resolve_api_key` returns it. The MCP route maps scope → governed Actor role (read→viewer, write→operator), so `requiredPermission` is enforceable per key.
- `src/lib/agents/mcp-writes.ts` — the governed-write impls (`draftTouchImpl`, `requestWarmIntroImpl`) + `warmIntroAuthorize` (the warm-intro's authority is its **active partnership**, not the federation context-grant model).
- `src/lib/pursuits/federation/skills.ts` — two new governed skills: `draft_campaign_touch` (INTERNAL_WRITE) and `request_warm_intro` (CROSS_TENANT_ACTION). Added an optional `authorize` hook so a CROSS_TENANT_ACTION skill can supply its own consent fabric (partnership consent) in place of the default `hasActionAuthority` (context grants).
- `src/lib/agents/mcp-tools.ts` — write tools now carry `write:true` + `skillId`; their inline `run()` **refuses** (no ungoverned path). Dangling domain imports removed.
- `src/app/api/mcp/route.ts` — a write tool is dispatched through `dispatchSkill` with an AGENT actor built from the key's scope; never run inline.
- `src/lib/agents/ask.ts` — the autonomous Ask LLM tool set filters out **every** write tool (`!t.write`), not just `draft_touch`; the false "one write tool" comment is corrected. No autonomous cross-tenant write remains.
- `scripts/governed-mutation-verify.ts` — blind harness.

## Blind harness — 13 / 13
- **No ungoverned MCP write path:** write tools are declared, each carries a skill id, each inline `run()` throws, and the Ask LLM tool set contains no write tool.
- **draft_campaign_touch governed:** a read-scoped (viewer) actor is REJECTED; an operator EXECUTES; the draft is really created; a `governed_action_invocations` row records it (auditable). Idempotent on a repeated key.
- **request_warm_intro governed cross-tenant:** REJECTED without an active partnership (its own partnership authority), and the rejection is a recorded invocation (not a silent skip); with authority it is dispatched through the boundary as a `CROSS_TENANT_ACTION` invocation — the cross-tenant write never happens except via a governed invocation.

## Gate
tsc **clean** · migration **88 applied** (additive: `add column if not exists` + resolver return-type update, **no destructive statements**) · no ungoverned agent/MCP write path · no autonomous cross-tenant LLM write · regression E3-A…E3-H **134/134**.

## Scope note (surfaced for objection)
Per D1's list, "outreach execution" is a governed concern. The worker's `sendTouchNow` already enforces human approval + a status guard (only `approved`/`scheduled` → `sent`, so no double-send). Routing the send through the **async governed outbox/receipt** path (audit invocation + retry + compensation) is deferred to **R1-G4** (governed-action robustness), where the outbox executor lives, rather than destabilizing the live synchronous send here. Flagged so it can be pulled into G1 if required.

**R1-G1 complete. Proceeding to R1-G2 (tenant-scoped feature flags).**
