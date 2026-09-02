import { withTenant } from "@/lib/db/tenant";
import { Assurance, Card, Disclosure, PageHeader, BlockLabel, SectionHeading } from "@/components/ui";
import { byoModelAvailable, hasOrgAnthropicKey } from "@/lib/ai/org-keys";

export const dynamic = "force-dynamic";

/**
 * Trust center (slice C): where the data goes, which models see what, what is
 * retained, and what is auditable — assembled from the live record wherever a
 * number exists, prose only where it must be. Enterprise procurement reads
 * this page before anyone books a demo call; it should never need a meeting.
 */

export default async function TrustPage() {
  // RISK-1: org stats read under withTenant (pins app.org_id).
  const { stats, models, ownKey } = await withTenant(async (db, orgId) => ({
    stats: (await db.query<{
      audit_n: string; agent_runs: string; evidence_n: string; verified_n: string; providers: string; keys: string;
    }>(
      `select (select count(*) from audit_log where org_id = $1) as audit_n,
            (select count(*) from agent_runs where org_id = $1) as agent_runs,
            (select count(*) from evidence where org_id = $1 or org_id is null) as evidence_n,
            (select count(*) from evidence where (org_id = $1 or org_id is null) and status = 'verified') as verified_n,
            (select count(*) from providers) as providers,
            (select count(*) from api_keys where org_id = $1 and revoked_at is null) as keys`,
      [orgId],
    )).rows,
    models: (await db.query<{ model: string; n: string }>(
      `select model, count(*) as n from agent_runs where org_id = $1 group by model order by count(*) desc limit 5`,
      [orgId],
    )).rows,
    ownKey: await hasOrgAnthropicKey(db, orgId),
  }));
  const s = stats[0];

  return (
    <main>
      <PageHeader
        title="Trust center"
        subtitle="How several companies work one pursuit without exposing everything."
      />

      {/* The six guarantees, stated as mechanisms rather than counters. Each line
          says only what the running system enforces — no certification is
          claimed, and where a live figure exists it sits under the mechanism it
          evidences rather than in a separate strip of its own. */}
      <div className="mb-7 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <Assurance
          label="Tenant isolation"
          mechanism="Postgres row-level security, forced on every table"
          note="No query path can opt out of the tenant predicate"
        />
        <Assurance
          label="Governed sharing"
          mechanism="Offer → accept, rung by rung"
          note="Partner data crosses only at a rung both owners approved"
        />
        <Assurance
          label="Human approval"
          mechanism="Nothing sends, registers or discloses on its own"
          note="Agents draft; a person decides"
        />
        <Assurance
          label="Auditability"
          mechanism="Every consequential act is on a ledger"
          note={`${Number(s.audit_n).toLocaleString()} entries recorded in this tenant`}
        />
        <Assurance
          label="Revocable access"
          mechanism="Recipients hold live reads, never copies"
          note="Revoking stops the read immediately"
        />
        <Assurance
          label="Grounded AI"
          mechanism="Agents read the verified record and must cite it"
          note={`${Number(s.evidence_n).toLocaleString()} claims held · ${s.verified_n} verified, rest quarantined`}
        />
      </div>

      <SectionHeading hint="The detail behind each guarantee, and the live record it runs on.">
        How it works
      </SectionHeading>

      {/* Four walls of prose became four accordions. Nothing was deleted — the
          residency paragraph, the subprocessor list and the GDPR mechanics are
          all still here, and procurement still never needs a meeting. What
          changed is that a reader now chooses which one to open instead of
          being handed 600 words at once. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <Card>
          <BlockLabel>How data flows</BlockLabel>
          <ol className="list-decimal space-y-1.5 pl-5 text-copy ink-soft">
            <li><b>In:</b> research providers, CSV lanes (profiled in-tenant — no third party sees your files), meeting notes, email engagement.</li>
            <li><b>Gate:</b> every claim gets source trust &times; extraction confidence; below threshold it quarantines for human review. Contradictions surface, never average away.</li>
            <li><b>Record:</b> the verified, provenance-tracked account record — the only thing agents are allowed to read.</li>
            <li><b>Out:</b> nothing sends, registers, or discloses without a human approval or a partnership consent rung.</li>
          </ol>
        </Card>

        <Card>
          <BlockLabel>AI &amp; models</BlockLabel>
          {models.length === 0 ? (
            <p className="text-copy ink-faint">No AI runs recorded in this tenant yet.</p>
          ) : (
            <ul className="mb-2 space-y-1 text-copy">
              {models.map((m) => (
                <li key={m.model} className="flex justify-between">
                  <span className="font-mono text-body ink-faint">{m.model}</span>
                  <span className="tnum ink-soft">{m.n} runs</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-copy ink-soft">
            {ownKey ? (
              <b style={{ color: "var(--color-accent-verified)" }}>This tenant runs on its own AI key — its data rides its own contract.</b>
            ) : byoModelAvailable() ? (
              <>Bring-your-own-model is available in Admin: supply your key and your data rides your AI contract.</>
            ) : (
              <>Bring-your-own-model activates once the server carries an encryption key.</>
            )}
          </p>
          <Disclosure summary="How routing works" className="mt-2.5">
            Agents draft only from the verified record and must cite it. Two-tier routing keeps frontier
            models off routine volume.
          </Disclosure>
        </Card>

        <Card>
          <BlockLabel>Isolation &amp; controls</BlockLabel>
          <ul className="list-disc space-y-1.5 pl-5 text-copy ink-soft">
            <li>Multi-tenant with Postgres row-level security; partner visibility is governed by a consent ladder both owners approve, rung by rung.</li>
            <li>Strict Content-Security-Policy with per-request nonces; rate limiting on the edge; independent nightly database backups.</li>
            <li>Agent access (MCP) uses per-org bearer keys — reads mirror your screens, the only write creates drafts behind your gates, revocation is instant.</li>
          </ul>
          <Disclosure summary="Sharing and data-subject rights" className="mt-2.5">
            Sharing anything — a list, a skill, a claim, an intro — is offer &rarr; accept, audited on both
            ledgers and revocable; consent is mechanics, not paperwork. GDPR data-subject rights are built
            in: an owner can export a person&rsquo;s data as portable JSON (Art. 15/20) and erase it
            (Art. 17), anonymized in one transaction, scoped to your tenant, logged with a one-way hash of
            the email and never the address.
          </Disclosure>
        </Card>

        <Card>
          <BlockLabel>Residency &amp; retention</BlockLabel>
          <p className="text-copy ink-soft">
            Your primary data — CRM records, evidence, decisions, ledgers — is stored in{" "}
            <b className="ink">Canada (AWS ca-central-1)</b> on Supabase Postgres, and the independent
            nightly backups stay in that region.
          </p>
          <p className="mt-2 text-copy ink-soft">
            Your record is yours: it persists until you delete it, and deleting an organization cascades its
            data. Revoked shares stop being readable immediately.
          </p>
          <Disclosure summary={`Subprocessors and regions (${Number(s.providers)} providers registered)`} className="mt-2.5">
            Sub-processors that perform <i>transient</i> processing — never the system of record — operate in
            their own regions, primarily the US. EU / in-region data pinning is available to enterprise
            customers under a DPA; ask us. Anthropic (AI inference, US), Supabase (Postgres — system of
            record, Canada / ca-central-1), Vercel (app hosting, global edge / US primary), Railway (research
            worker, US), Resend (email delivery, US, when enabled), Tavily and People Data Labs (research
            providers, US, when enabled). Each registered provider can be disabled per tenant.
          </Disclosure>
        </Card>
      </div>
    </main>
  );
}
