# PursuitOS Communications (Phase 5)

V1 provider: **Resend** (sending + inbound under one roof), behind an
`EmailProvider` abstraction (`src/lib/comms/provider.ts`) so Microsoft 365 /
Google Workspace / SendGrid / SES can replace or supplement it later without
touching the commercial workflow.

## Architecture decisions (canonical)

1. **Never send from the primary company domain.** Outbound:
   `engage.<domain>`; inbound conversation capture: `threads.<domain>`.
   A campaign reputation problem must never touch the corporate domain.
2. **No partner/vendor impersonation in V1.** Two modes:
   - **Mode A — facilitated**: `Dana Whitfield via PursuitOS
     <dana.whitfield+<alias>@engage...>`, Reply-To on the thread address.
   - **Mode B — seller-assisted**: PursuitOS drafts; the seller sends from
     their own mailbox and CCs the thread address. Preserves real identity,
     still captures the conversation. (Native mailbox OAuth is Phase 5.5/6.)
3. **Thread aliases are motion-scoped** (`m_xxxxxxxxxx@threads...`), never
   seller-scoped. The alias resolves to org/account/motion/campaign/sellers.
4. **Deterministic thread matching**, in order: alias → In-Reply-To →
   References → provider id → participants+subject → human triage
   (`inbound_triage`). An LLM never decides thread ownership.
5. **Persist before AI.** The raw message lands in `messages` before the
   Conversation Agent sees the stripped reply text.
6. **Human approval is mandatory** for all outbound. The untouched AI draft
   persists (`messages.ai_draft`); seller edits land in `message_edits`
   with edit distance — the messaging learning loop's training data.
7. **Suppression before every send, no exceptions** (`suppression_list`:
   unsubscribe / hard bounce / spam complaint / manual / customer policy).
   Contact engagement state lives on `contacts.engagement_status`.
8. **Customer replies are first-party evidence** (`customer_email` source,
   trust 0.9) flowing through the SAME verification gates, then signals →
   rescore → the account's "What changed" surfaces the move.
9. **Email is one channel.** Everything emits generalized
   `interaction_events` (EMAIL/CALL/MEETING/…) so learning never binds to
   email specifically.
10. **Open tracking is recorded but not trusted.** Signal ranking: replies >
    meetings > customer-supplied info > clicks > opens.

## Inbound flow

webhook (svix-verified) → persist raw → resolve thread → normalize
participants (contact upsert, engaged) → strip quotes/signature →
Conversation Agent → `{response_type, intent_strength, topics, objections,
needs, technologies, competitors, timing, budget, stakeholders,
recommended_next_action, evidence_claims}` → evidence through quality gates →
signals → rescore → communication_action into the Queue.
UNSUBSCRIBE classification suppresses immediately.

## Go-live checklist (owner: Chris)

1. In Resend: add domains `engage.pursuitos.io` (sending) and
   `threads.pursuitos.io` (receiving); add the DNS records Resend shows
   (SPF TXT, DKIM CNAMEs/TXT, MX for the threads domain) at the registrar.
   Add a DMARC TXT on `_dmarc.pursuitos.io` (start `p=none`, tighten later).
2. Create an API key → `RESEND_API_KEY` (Vercel env + `.env.local`).
3. Create a webhook pointing at
   `https://pursuitos.vercel.app/api/webhooks/resend` subscribed to
   delivery events + inbound email; copy its signing secret →
   `RESEND_WEBHOOK_SECRET`. (The route rejects unsigned calls and is exempt
   from Basic Auth.)
4. Optionally override `EMAIL_OUTBOUND_DOMAIN` / `EMAIL_THREADS_DOMAIN`
   (defaults: engage/threads.pursuitos.io).

Until the key is set, Mode A is disabled in the UI; Mode B (package for
seller) works immediately.
