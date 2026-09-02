import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@/lib/db/tenant";
import { Card, PageHeader, BlockLabel, Disclosure } from "@/components/ui";
import { EvidenceModel } from "@/components/evidence-model";

export const dynamic = "force-dynamic";

/**
 * Contact detail (Wave 5 §8/§11).
 *
 * WHY THIS EXISTS. The Contacts room could name a person and then had nowhere
 * to send you. Everything a seller needs before reaching out — is there an
 * address, has anyone here already spoken to them, what buying role has been
 * asserted and on what evidence, which pursuits they sit on — was spread across
 * a twelve-column row, a hover title and three other rooms.
 *
 * WHAT IT SHOWS. Only what is stored: the contact record, the partner and
 * account it hangs off, every stakeholder assertion with its state and source,
 * and the interaction history actually logged against this person. Where the
 * record is empty the page says so rather than drawing an empty instrument.
 *
 * People discovered by intelligence but never resolved to a contact row have no
 * page here, and the list deliberately does not link them — a detail page for a
 * person the system cannot act on would be a fiction.
 */

const TYPE_LABELS: Record<string, string> = {
  end_user: "End user",
  reseller: "Reseller",
  distributor: "Distributor",
  msp: "MSP",
  solution_provider: "Solution provider",
  agent: "Agent",
  alliance: "Alliance",
  vendor: "Vendor",
  other: "Other",
};

/** §10 vocabulary, applied to a person: can we reach them, and did it work? */
const REACH_MEANING: Record<string, string> = {
  engaged: "They have responded to something we sent.",
  bounced: "Mail to this address has failed — the address is wrong or dead.",
  opted_out: "They have asked not to be contacted. Nothing may be sent.",
  do_not_contact: "Marked do-not-contact. Nothing may be sent.",
  unknown: "Deliverable as far as we know, but nothing has come back yet.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const data = await withTenant(async (db) => {
    const { rows } = await db.query<{
      id: string;
      name: string | null;
      title: string | null;
      email: string | null;
      phone: string | null;
      contact_type: string;
      location: string | null;
      attributes: Record<string, unknown> | null;
      engagement_status: string;
      company_id: string | null;
      legal_name: string | null;
      primary_domain: string | null;
      partner_id: string | null;
      partner_name: string | null;
      engagement_score: string | null;
      scored_at: Date | null;
    }>(
      `select c.id, c.name, c.title, c.email, c.phone, c.contact_type, c.location, c.attributes,
              c.engagement_status, c.company_id, co.legal_name, co.primary_domain,
              c.partner_id, p.name as partner_name,
              es.engagement_score, es.computed_at as scored_at
         from contacts c
         left join companies co on co.id = c.company_id
         left join partners p on p.id = c.partner_id
         left join lateral (select engagement_score, computed_at from engagement_scores
                             where contact_id = c.id order by computed_at desc limit 1) es on true
        where c.id = $1`,
      [id],
    );
    if (rows.length === 0) return null;

    // Every assertion, not just the strongest — the disagreement between two
    // assertions is information a seller needs before a call.
    const { rows: stakeholders } = await db.query<{
      role: string;
      sentiment: string;
      assertion_state: string | null;
      source: string | null;
      asserted_at: Date | null;
      asserted_pursuit_id: string | null;
      pursuit_id: string | null;
      pursuit_type: string | null;
      pursuit_status: string | null;
      pursuit_account: string | null;
      opportunity_id: string | null;
      opportunity_name: string | null;
      opportunity_stage: string | null;
    }>(
      /* Both ids. s.pursuit_id is what the assertion claims; pu.id is what this
         tenant can actually read. Where they disagree the assertion is real and
         the destination is not, and the page says exactly that rather than
         either hiding the assertion or linking somewhere that will not open. */
      `select s.role, s.sentiment, s.assertion_state, s.source, s.asserted_at,
              s.pursuit_id as asserted_pursuit_id,
              pu.id as pursuit_id, pu.pursuit_type, pu.status as pursuit_status, pc.legal_name as pursuit_account,
              o.id as opportunity_id, o.name as opportunity_name, o.stage as opportunity_stage
         from stakeholders s
         left join pursuits pu on pu.id = s.pursuit_id
         left join companies pc on pc.id = pu.account_id
         left join opportunities o on o.id = s.opportunity_id
        where s.contact_id = $1
        order by case s.assertion_state when 'verified' then 3 when 'inferred' then 2 else 1 end desc,
                 s.asserted_at desc nulls last`,
      [id],
    );

    const { rows: history } = await db.query<{
      type: string;
      channel: string;
      actor: string | null;
      occurred_at: Date;
      company_id: string | null;
    }>(
      `select type, channel, actor, occurred_at, company_id
         from interaction_events where contact_id = $1
        order by occurred_at desc limit 12`,
      [id],
    );

    return { c: rows[0], stakeholders, history };
  });

  if (!data) notFound();
  const { c, stakeholders, history } = data;
  const attrs = c.attributes ?? {};
  const attr = (k: string) => {
    const v = attrs[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  const coverage = [
    ["Territory", attr("territory") ?? c.location],
    ["Vertical", attr("vertical")],
    ["Segment", attr("segment")],
  ].filter(([, v]) => v) as [string, string][];

  const reachable = Boolean(c.email);
  const blocked = c.engagement_status === "opted_out" || c.engagement_status === "do_not_contact";
  const score = c.engagement_score == null ? null : Number(c.engagement_score);
  const verified = stakeholders.filter((s) => s.assertion_state === "verified");

  return (
    <main>
      <PageHeader
        title={c.name ?? c.email ?? "Contact"}
        subtitle={[c.title, TYPE_LABELS[c.contact_type] ?? c.contact_type].filter(Boolean).join(" · ")}
      />
      <EvidenceModel current="contacts" steps={{ contacts: { label: "one person" } }} />

      {/* The one sentence a seller needs before they do anything else. */}
      <Card className="mb-4">
        <p className="text-title font-semibold ink">
          {blocked
            ? "Do not contact this person."
            : !reachable
              ? "No address on file — this person cannot be reached from here."
              : verified.length > 0
                ? `Reachable, with a verified buying role on ${verified.length} pursuit${verified.length === 1 ? "" : "s"}.`
                : "Reachable. No buying role has been verified yet."}
        </p>
        <p className="mt-1 text-body ink-muted">
          {REACH_MEANING[c.engagement_status] ?? REACH_MEANING.unknown}
          {!reachable && " They are known to the system from partner or intelligence records only."}
        </p>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <BlockLabel>Reach</BlockLabel>
          <dl className="grid gap-x-4 gap-y-1.5 text-copy" style={{ gridTemplateColumns: "auto 1fr" }}>
            <dt className="ink-faint">Email</dt>
            <dd>
              {c.email ? (
                <a href={`mailto:${c.email}`} className="text-accent hover:underline dark:text-blue-400">{c.email}</a>
              ) : (
                <span className="ink-faint">none on file</span>
              )}
            </dd>
            <dt className="ink-faint">Phone</dt>
            <dd>{c.phone ?? <span className="ink-faint">none on file</span>}</dd>
            {/* §10: "unknown" is a registry value, not a thing to tell a seller.
                What they need to know is whether anything has come back. */}
            <dt className="ink-faint">Response</dt>
            <dd className="font-medium">
              {c.engagement_status === "unknown" ? "nothing received back yet" : c.engagement_status.replace(/_/g, " ")}
            </dd>
            {score != null && (
              <>
                <dt className="ink-faint">Engagement</dt>
                <dd>
                  <span className="tnum font-semibold">{score.toFixed(0)}</span>
                  {c.scored_at && (
                    <span className="ink-faint"> · scored {new Date(c.scored_at).toISOString().slice(0, 10)}</span>
                  )}
                </dd>
              </>
            )}
          </dl>
        </Card>

        <Card>
          <BlockLabel>Relationship</BlockLabel>
          <dl className="grid gap-x-4 gap-y-1.5 text-copy" style={{ gridTemplateColumns: "auto 1fr" }}>
            <dt className="ink-faint">Company</dt>
            <dd>
              {c.company_id ? (
                <Link href={`/accounts/${c.company_id}`} className="text-accent hover:underline dark:text-blue-400">
                  {c.legal_name ?? "account"} →
                </Link>
              ) : (
                <span className="ink-faint">not attributed to an account</span>
              )}
              {c.primary_domain && <span className="ml-2 text-label ink-faint">{c.primary_domain}</span>}
            </dd>
            <dt className="ink-faint">Held by</dt>
            <dd>
              {c.partner_id ? (
                <Link href={`/partners/${c.partner_id}`} className="text-accent hover:underline dark:text-blue-400">
                  {c.partner_name} →
                </Link>
              ) : (
                <span className="ink-muted">Direct — no partner holds this relationship</span>
              )}
            </dd>
            {coverage.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="ink-faint">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <BlockLabel>Pursuits this person sits on</BlockLabel>
      {stakeholders.length === 0 ? (
        <Card className="mb-5">
          <p className="text-copy ink-muted">
            No buying role has been asserted for this person on any pursuit. A role is asserted from
            the account room or by an agent, and always carries the state it was asserted in.
          </p>
        </Card>
      ) : (
        <div className="mb-5 space-y-1.5">
          {stakeholders.map((s, i) => (
            <Card key={`${s.pursuit_id ?? s.opportunity_id ?? "x"}-${i}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-copy font-semibold ink">{s.role.replace(/_/g, " ")}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-[0.04em]"
                  style={
                    s.assertion_state === "verified"
                      ? { color: "var(--color-accent-verified)", background: "color-mix(in srgb, var(--color-accent-verified) 12%, transparent)" }
                      : s.assertion_state === "inferred"
                        ? { color: "var(--color-timing)", background: "color-mix(in srgb, var(--color-timing) 14%, transparent)" }
                        : { color: "var(--ink-faint)", background: "var(--surface-inset)" }
                  }
                >
                  {s.assertion_state ?? "unverified"}
                </span>
                <span className="text-body ink-muted">sentiment {s.sentiment}</span>
                <span className="ml-auto text-label ink-faint">
                  {s.source ? `asserted by ${s.source.toLowerCase()}` : "source not recorded"}
                  {s.asserted_at && ` · ${new Date(s.asserted_at).toISOString().slice(0, 10)}`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-body">
                {s.pursuit_id ? (
                  <Link href={`/pursuits/${s.pursuit_id}#stakeholders`} className="text-accent hover:underline dark:text-blue-400">
                    {(s.pursuit_account ?? "pursuit")} · {(s.pursuit_type ?? "").replace(/_/g, " ").toLowerCase() || "pursuit"} →
                  </Link>
                ) : s.asserted_pursuit_id ? (
                  /* The assertion names a pursuit, but this tenant cannot read
                     it. Saying so is the honest reading; pretending there is no
                     pursuit would be false, and linking to it would 404. */
                  <span className="ink-faint">Asserted against a pursuit outside your scope.</span>
                ) : (
                  <span className="ink-faint">No pursuit linked to this assertion.</span>
                )}
                {s.pursuit_status && <span className="ink-muted">{s.pursuit_status.replace(/_/g, " ").toLowerCase()}</span>}
                {/* Stated, not linked: Pipeline takes no per-opportunity query
                    parameter, so a link here would silently drop the filter and
                    land the reader on the whole board. The pursuit link beside
                    it is the real destination. */}
                {s.opportunity_id && (
                  <span className="ink-muted">
                    {s.opportunity_name ?? "opportunity"}
                    {s.opportunity_stage && ` · ${s.opportunity_stage.replace(/_/g, " ")}`}
                  </span>
                )}
              </div>
            </Card>
          ))}
          <Disclosure summary="What verified, inferred and unverified mean here">
            <b>Verified</b> — a person confirmed the role. <b>Inferred</b> — an agent concluded it from
            evidence and it has not been confirmed. <b>Unverified</b> — recorded without either. The
            state travels with the assertion everywhere it is shown; it is never averaged away into a
            single confidence number.
          </Disclosure>
        </div>
      )}

      <BlockLabel>What has actually happened</BlockLabel>
      {history.length === 0 ? (
        <Card>
          <p className="text-copy ink-muted">
            Nothing has been logged against this person — no message, call or meeting recorded here.
          </p>
        </Card>
      ) : (
        <Card>
          <ul className="space-y-1 text-copy">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3">
                <span className="tnum text-label ink-faint">{new Date(h.occurred_at).toISOString().slice(0, 10)}</span>
                <span className="font-medium">{h.type.replace(/_/g, " ").toLowerCase()}</span>
                <span className="ink-muted">{h.channel.toLowerCase()}</span>
                {h.actor && <span className="ink-faint">· {h.actor}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
