# PursuitOS in your AI — the packaged connector

PursuitOS exposes its verified revenue record to any MCP-speaking assistant —
Claude (claude.ai, Claude Code, Claude Desktop), Copilot, or your in-house
agents. The same shift Claudeforce made for the CRM, this makes for the
evidence layer: your assistant reasons over the record, and the record's
governance travels with every call.

## Connect

- **Endpoint**: `https://<your-tenant>/api/mcp` (streamable HTTP)
- **Auth**: bearer key minted in **Admin → Agent access**; revoking a key cuts
  the assistant off instantly.
- **Claude (custom connector)**: Settings → Connectors → Add custom connector →
  paste the endpoint URL and key.
- **Claude Code / MCP config**:

```json
{
  "mcpServers": {
    "pursuitos": {
      "type": "http",
      "url": "https://<your-tenant>/api/mcp",
      "headers": { "Authorization": "Bearer pos_..." }
    }
  }
}
```

## What your assistant can do

Reads mirror exactly what your own screens show. The only writes create
requests or drafts that land behind the same human gates the platform's own
agents face.

| Tool | Ask your assistant… |
| --- | --- |
| `pipeline_summary` | "How's my pipeline, weighted by our own stage odds?" |
| `account_brief` | "Prep me for the Umbrella call." |
| `deal_context` | "Walk me through the whole Initech deal — both companies' halves." |
| `partner_context` | "Where do we stand with Meridian — ladder, joint rooms, initiatives, settlement?" |
| `initiative_status` | "Are we on pace against the FY27 automation target?" |
| `overlap_status` | "Which partnerships have named overlap approved?" |
| `joint_pursuits` | "Which joint rooms are live and who's waiting on whom?" |
| `org_skills` | "Ground your drafting in our positioning and rules." |
| `request_warm_intro` | "Ask Meridian for a warm path into Initech." *(creates a request the partner decides)* |
| `draft_touch` | "Draft a follow-up for the campaign." *(lands as a draft behind approval)* |

## The governance contract

- Every call is scoped to the key's tenant; partner data appears only at the
  disclosure rung both owners approved.
- `partner_context` is the agent-to-agent surface: the payload is identical in
  shape for both tenants, so neither side's assistant ever knows more than the
  partnership consented to.
- Writes never send, register, or reveal anything by themselves — they create
  requests and drafts that a human (or the counterpart org) must decide.
- Every agent action lands on the audit ledger, same as a human's.
