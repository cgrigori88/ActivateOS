import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { Bento, Card, PageHeader } from "@/components/ui";
import { byoModelAvailable, hasOrgAnthropicKey } from "@/lib/ai/org-keys";

export const dynamic = "force-dynamic";

/**
 * Trust center (slice C): where the data goes, which models see what, what is
 * retained, and what is auditable — assembled from the live record wherever a
 * number exists, prose only where it must be. Enterprise procurement reads
 * this page before anyone books a demo call; it should never need a meeting.
 */

export default async function TrustPage() {
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const { rows: stats } = await pool.query<{
    audit_n: string; agent_runs: string; evidence_n: string; verified_n: string; providers: string; keys: string;
  }>(
    `select (select count(*) from audit_log where org_id = $1) as audit_n,
            (select count(*) from agent_runs where org_id = $1) as agent_runs,
            (select count(*) from evidence where org_id = $1 or org_id is null) as evidence_n,
            (select count(*) from evidence where (org_id = $1 or org_id is null) and status = 'verified') as verified_n,
            (select count(*) from providers) as providers,
            (select count(*) from api_keys where org_id = $1 and revoked_at is null) as keys`,
    [orgId],
  );
  const s = stats[0];
  const { rows: models } = await pool.query<{ model: string; n: string }>(
    `select model, count(*) as n from agent_runs where org_id = $1 group by model order by count(*) desc limit 5`,
    [orgId],
  );
  const ownKey = await hasOrgAnthropicKey(pool, orgId);

  return (
    <main>
      <PageHeader
        title="Trust center"
        subtitle="Where your data goes, which models see it, what is retained, and what is auditable — the live figures, not a policy PDF."
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <Bento label="audit ledger" value={Number(s.audit_n).toLocaleString()} subs={["every consequential act, human or agent"]} />
        <Bento label="AI runs recorded" value={Number(s.agent_runs).toLocaleString()} subs={["model, cost, and cited evidence per run"]} />
        <Bento label="claims held" value={Number(s.evidence_n).toLocaleString()} subs={[`${s.verified_n} verified · rest quarantined for review`]} />
        <Bento label="active agent keys" value={s.keys} subs={["revocable instantly in Admin"]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">How data flows</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
            <li><b>In:</b> research providers, CSV lanes (profiled in-tenant — no third party sees your files), meeting notes, email engagement.</li>
            <li><b>Gate:</b> every claim gets source trust × extraction confidence; below threshold it quarantines for human review. Contradictions surface, never average away.</li>
            <li><b>Record:</b> the verified, provenance-tracked account record — the only thing agents are allowed to read.</li>
            <li><b>Out:</b> nothing sends, registers, or discloses without a human approval or a partnership consent rung. Partner data crosses the fence only at the rung both owners approved.</li>
          </ol>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">AI &amp; models</h2>
          {models.length === 0 ? (
            <p className="text-sm text-neutral-500">No AI runs recorded yet.</p>
          ) : (
            <ul className="mb-2 space-y-1 text-sm">
              {models.map((m) => (
                <li key={m.model} className="flex justify-between">
                  <span className="font-mono text-xs text-neutral-500">{m.model}</span>
                  <span className="tnum text-neutral-600 dark:text-neutral-300">{m.n} runs</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Agents draft only from the verified record and must cite it. Two-tier routing keeps frontier models off routine volume.{" "}
            {ownKey ? (
              <b className="text-emerald-700 dark:text-emerald-400">This tenant runs on its own AI key — its data rides its own contract.</b>
            ) : byoModelAvailable() ? (
              <>Bring-your-own-model is available in Admin: supply your key and your data rides your AI contract.</>
            ) : (
              <>Bring-your-own-model activates once the server carries an encryption key.</>
            )}
          </p>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Isolation &amp; controls</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600 dark:text-neutral-300">
            <li>Multi-tenant with Postgres row-level security; partner visibility is governed by a consent ladder both owners approve, rung by rung.</li>
            <li>Strict Content-Security-Policy with per-request nonces; rate limiting on the edge; independent nightly database backups.</li>
            <li>Agent access (MCP) uses per-org bearer keys — reads mirror your screens, the only write creates drafts behind your gates, revocation is instant.</li>
            <li>Sharing anything (a list, a skill, a claim, an intro) is offer → accept, audited on both ledgers, revocable — consent is mechanics, not paperwork.</li>
            <li>GDPR data-subject rights are built in: an owner can export a person&apos;s data as portable JSON (Art. 15/20) and erase it (Art. 17) — anonymized in one transaction, scoped to your tenant, logged with a one-way hash of the email, never the address.</li>
          </ul>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Retention &amp; subprocessors</h2>
          <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">
            Your record is yours: evidence, decisions, and ledgers persist until you delete them; deleting an organization cascades its data. Revoked shares stop being readable immediately — recipients hold live reads, never copies.
          </p>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Subprocessors: Anthropic (AI inference), Supabase (Postgres), Vercel (app hosting), Railway (research worker), Resend (email delivery, when enabled), Tavily &amp; People Data Labs (research providers, when enabled). {Number(s.providers)} intelligence providers are registered; each can be disabled per tenant.
          </p>
        </Card>
      </div>
    </main>
  );
}
