import { notFound } from "next/navigation";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { executePursuitQuery, resolveGoTo } from "@/lib/experience/execute";
import { explainPlanFor, isViewKey, PLANS, VIEW_KEYS, type ViewKey } from "@/lib/experience/plans";
import { FIELDS, METRICS, metricKey } from "@/lib/experience/registry";
import { buildContextManifest } from "@/lib/experience/intent/context";
import { compileIntent } from "@/lib/experience/intent/compile";
import { runCompiledIntent } from "@/lib/experience/intent/run";
import { PROMPT_TEMPLATE_VERSION, intentModelEnabled, proposeIntent, recordIntentProvenance } from "@/lib/experience/intent/model";
import { CLARIFICATION_QUESTIONS } from "@/lib/experience/intent/vocabulary";
import type { AggregateResult, Explanation, GoToOutcome, GovernedCell, GovernedResultSet } from "@/lib/experience/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * P7 SLICE 1 — the first governed projection. TRANSPORT ONLY.
 *
 * This file contains no metric, no governance, no disclosure and no query semantics: it selects a
 * code-defined plan, calls the shared execution boundary, and renders what comes back. If a rule
 * about what may be seen appears in this file, that is the defect (ruling 6).
 *
 * GATING, both layers (ruling 1): `pursuitExperienceEnabled()` is the environment master and denies
 * here before any database work; `experienceEnabledFor(db, orgId)` is the org's own entitlement and
 * denies inside the governed path. The route is UNLINKED and its path is not yet a permanent
 * product-navigation contract (ruling 2).
 *
 * A suppressed cell renders as "not disclosable" — never as a blank that reads as zero, and never
 * with a title/tooltip carrying the withheld value. The value is not here to leak: it was dropped
 * at governance resolution, not hidden at render.
 */
export default async function ExperiencePursuitsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; explain?: string; goto?: string; ask?: string; propose?: string; ctx?: string }>;
}) {
  if (!pursuitExperienceEnabled()) notFound();   // deployment master — fast deny, no DB work

  const sp = await searchParams;

  // GO TO (Slice 4). Transport only: it names WHICH object and nothing else — no path, no route, no
  // organization — and it does not pre-filter the id, because refusing a malformed one is the
  // boundary's job and that is where the proof lives. No redirect is issued: this renders the
  // resolved target as a link, and only after governance succeeded.
  if (typeof sp.goto === "string") {
    const outcome = await resolveGoTo({ requestVersion: 1, ref: { class: "pursuit", id: sp.goto }, surface: "canonical" });
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-10">
        <h1 className="text-section font-extrabold tracking-[-0.03em]">Go to</h1>
        <Navigation outcome={outcome} />
      </main>
    );
  }

  const view: ViewKey = isViewKey(sp.view) ? sp.view : "open-by-value";

  // INTENT (Slice 5). `?ask=` asks the model for a proposal; `?propose=` supplies one directly. Both
  // are UNTRUSTED input and go through the same deterministic compiler — which is the point: a
  // proposal's authority does not depend on whether a model or a caller wrote it.
  if (typeof sp.ask === "string" || typeof sp.propose === "string") {
    return <IntentView ask={sp.ask} propose={sp.propose} ctx={sp.ctx} view={view} />;
  }

  // `?explain=<id>` names WHICH object, never which organization: governance still decides whether
  // it is visible. A malformed id is simply not a plan we will build.
  const subject = typeof sp.explain === "string" && UUID.test(sp.explain) ? sp.explain : null;
  const outcome = await executePursuitQuery(subject ? explainPlanFor(subject) : PLANS[view].plan);

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-10">
      <h1 className="text-section font-extrabold tracking-[-0.03em]">Pursuit experience</h1>
      <p className="mt-2 text-body text-neutral-500 dark:text-neutral-400">
        A governed projection over canonical pursuits. Every value below survived tenancy, derivation
        authority and disclosure resolution; nothing here is computed in the browser.
      </p>

      <nav className="mt-6 flex gap-2" aria-label="Views">
        {VIEW_KEYS.map((k) => (
          <a
            key={k}
            href={`/experience/pursuits?view=${k}`}
            aria-current={k === view ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-body font-semibold ${
              k === view
                ? "border-accent bg-accent/10 text-accent"
                : "border-neutral-300/80 hover:bg-neutral-900/[0.04] dark:border-white/15 dark:hover:bg-white/10"
            }`}
          >
            {PLANS[k].label}
          </a>
        ))}
      </nav>

      {!outcome.ok ? (
        <p role="alert" className="mt-8 rounded-input bg-rose/12 px-4 py-3 text-copy font-medium text-rose">
          {outcome.error === "CAPABILITY_DENIED" ? "This capability is not enabled here." : "That view could not be run."}{" "}
          <span className="font-normal">{outcome.detail}</span>
        </p>
      ) : outcome.explanation ? (
        <ExplanationView explanation={outcome.explanation} />
      ) : subject ? (
        <p className="mt-8 text-body text-neutral-500 dark:text-neutral-400">
          {/* No authorized subject: indistinguishable from one that does not exist. */}
          No explanation is available for that pursuit.
        </p>
      ) : (
        <>
          {outcome.aggregate && <Aggregate aggregate={outcome.aggregate} />}
          <Result result={outcome.result} view={view} />
        </>
      )}
    </main>
  );
}

function Result({ result, view }: { result: GovernedResultSet; view: ViewKey }) {
  const fields = result.plan.projection;
  const metrics = result.plan.metrics.map(metricKey);

  return (
    <>
      <table className="mt-8 w-full border-collapse text-copy">
        <thead>
          <tr className="border-b border-neutral-300/80 text-left dark:border-white/15">
            {fields.map((f) => (
              <th key={f} scope="col" className="py-2 pr-4 font-semibold">{FIELDS[f].label}</th>
            ))}
            {metrics.map((m) => (
              <th key={m} scope="col" className="py-2 pr-4 font-semibold">{METRICS[m].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.objectRef.id} className="border-b border-neutral-200/70 dark:border-white/10">
              {[...fields, ...metrics].map((ref) => (
                <td key={ref} className="py-2 pr-4 align-top">
                  {ref === "pursuit.id" ? (
                    <a className="text-accent underline" href={`/experience/pursuits?explain=${row.objectRef.id}`}>
                      Explain
                    </a>
                  ) : (
                    <Cell cell={row.cells[ref]} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {result.rows.length === 0 && (
        <p className="mt-8 text-body text-neutral-500 dark:text-neutral-400">
          No pursuits you are authorized to see match this view.
        </p>
      )}

      {/* The count describes the AUTHORIZED set, and says so — it is not a total. */}
      <p className="mt-6 text-body text-neutral-500 dark:text-neutral-400">
        {result.counts.authorized} pursuit{result.counts.authorized === 1 ? "" : "s"} you are authorized to see ·
        computed at {result.computedAt} · view <code>{view}</code>
      </p>
      {metrics.length > 0 && (
        <p className="mt-2 text-body text-neutral-500 dark:text-neutral-400">
          {metrics.map((m) => `${METRICS[m].label}: ${METRICS[m].provenance}`).join(" ")}
        </p>
      )}
    </>
  );
}

/**
 * P7 SLICE 5 — NATURAL-LANGUAGE INTENT. TRANSPORT ONLY.
 *
 * The order is the whole safety argument: the CONTEXT MANIFEST is built first, from rows this
 * principal's own governed execution returned, so every slot the model can point at was already
 * disclosable to them. Then an untrusted proposal is compiled deterministically, and only a compiled
 * intent executes — through boundaries certified in Slices 1–4, unchanged.
 *
 * Every successful execution states WHICH canonical operation ran (ruling 8), in words composed from
 * registry metadata rather than model prose, so a substituted intent is visible to the user.
 */
async function IntentView({ ask, propose, ctx, view }: { ask?: string; propose?: string; ctx?: string; view: ViewKey }) {
  // THE MASTER GATES THE MODEL CALL, AND NOTHING ELSE (ruling 6). With it off, a natural-language
  // request says so plainly — it does not fall through to a guessed proposal, a default view or an
  // execution. `?propose=` is unaffected, because deterministic compilation is not what this gates.
  const fromModel = typeof propose !== "string" && typeof ask === "string";
  const notice = (text: string) => (
    <main className="mx-auto max-w-[1100px] px-6 py-10">
      <h1 className="text-section font-extrabold tracking-[-0.03em]">Intent</h1>
      <p className="mt-8 text-body text-neutral-500 dark:text-neutral-400">{text}</p>
    </main>
  );

  // The manifest comes from a governed read for THIS principal — never from a lookup of its own.
  // It also carries the TENANT ENTITLEMENT: if the organization is not entitled to the Pursuit
  // experience, this is not ok, and the model is never asked. The conjunction is entitlement AND
  // master AND scoped credential, in that order.
  const base = await executePursuitQuery(PLANS[view].plan);
  if (fromModel && !base.ok) return notice("Natural-language requests are not enabled here.");
  const manifest = buildContextManifest(base.ok ? base.result.rows : []);

  // An untrusted proposal, from the model or supplied directly. Malformed JSON is simply not one.
  let proposal: unknown = null;
  // The ACTUAL provider model, as the call reported it — never a guess and never the tier name.
  let modelId: string | null = null;
  if (typeof propose === "string") {
    try { proposal = JSON.parse(propose); } catch { proposal = null; }
  } else if (typeof ask === "string") {
    const outcome = await proposeIntent(ask, manifest);
    // DISABLED and UNAVAILABLE are DIFFERENT answers, and neither is UNSUPPORTED: a provider outage
    // must not be reported as a limit of what the product can do.
    if (outcome.status === "DISABLED") return notice("Natural-language requests are not enabled here.");
    if (outcome.status === "UNAVAILABLE") return notice("Natural-language requests are temporarily unavailable.");
    proposal = outcome.proposal;
    modelId = outcome.meta.model;
  }

  const compiled = compileIntent({
    proposal,
    manifest,
    // A caller may state which manifest it was bound to; a mismatch refuses rather than retargeting.
    boundContextDigest: typeof ctx === "string" ? ctx : manifest.digest,
    // Provenance, not authority: both paths compile identically. A hand-authored proposal records
    // no model, because a provider that was never called is not provenance.
    source: fromModel ? "MODEL" : "HAND_AUTHORED",
    modelId: fromModel ? modelId : null,
    promptTemplateVersion: fromModel ? PROMPT_TEMPLATE_VERSION : null,
  });

  if (!compiled.ok) {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-10">
        <h1 className="text-section font-extrabold tracking-[-0.03em]">Intent</h1>
        <p className="mt-8 text-body text-neutral-500 dark:text-neutral-400">
          {compiled.state === "NEEDS_CLARIFICATION"
            ? CLARIFICATION_QUESTIONS[compiled.missing]
            : "That isn't something this surface can do."}
        </p>
      </main>
    );
  }

  // Recorded for operators before execution; it reaches no recipient-visible surface.
  recordIntentProvenance(compiled.intent.provenance);
  const executed = await runCompiledIntent(compiled.intent);
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-10">
      <h1 className="text-section font-extrabold tracking-[-0.03em]">Intent</h1>
      {/* The canonical operation that actually executed, from the registry — never model prose. */}
      <p className="mt-2 text-copy font-semibold">Interpreted as: {compiled.intent.interpretedAs}</p>

      {executed.kind === "NAVIGATION" ? (
        <Navigation outcome={executed.outcome} />
      ) : !executed.outcome.ok ? (
        <p role="alert" className="mt-8 rounded-input bg-rose/12 px-4 py-3 text-copy font-medium text-rose">
          {executed.outcome.error === "CAPABILITY_DENIED" ? "This capability is not enabled here." : "That view could not be run."}
        </p>
      ) : executed.outcome.explanation ? (
        <ExplanationView explanation={executed.outcome.explanation} />
      ) : compiled.intent.operation === "EXPLAIN" ? (
        <p className="mt-8 text-body text-neutral-500 dark:text-neutral-400">
          No explanation is available for that pursuit.
        </p>
      ) : (
        <>
          {executed.outcome.aggregate && <Aggregate aggregate={executed.outcome.aggregate} />}
          <Result result={executed.outcome.result} view={(compiled.intent.request as { view: ViewKey }).view} />
        </>
      )}
    </main>
  );
}

/**
 * The resolved navigation target. TRANSPORT ONLY — it re-checks nothing and could not: it receives a
 * value, not a query, and holds no database handle.
 *
 * THREE OUTCOMES AND NO FOURTH. A governed target renders as a link. `UNAVAILABLE_TARGET` acknowledges
 * the object — permitted, because governance already established that this recipient may know it
 * exists — in operation-level language naming no reason and no hidden attribute. Everything else
 * renders the ONE recipient-safe absence: unauthorized, nonexistent and malformed are the same bytes,
 * so naming an id reveals nothing about whether it exists (ruling 7).
 */
function Navigation({ outcome }: { outcome: GoToOutcome }) {
  if (outcome.ok) {
    return (
      <section className="mt-8">
        <p className="text-copy">
          <a className="text-accent underline" href={outcome.target.path}>{outcome.target.label}</a>
        </p>
        <p className="mt-3 text-body text-neutral-500 dark:text-neutral-400">
          {outcome.target.ref.class}@{outcome.target.surface}
        </p>
      </section>
    );
  }
  return (
    <p className="mt-8 text-body text-neutral-500 dark:text-neutral-400">
      {outcome.error === "UNAVAILABLE_TARGET"
        ? "This pursuit has no destination available for you."
        : "That pursuit is not available."}
    </p>
  );
}

/**
 * The cohort aggregate, with its provenance. A WITHHELD aggregate shows no value, no partial sum and
 * NO member count — a basis beside a withheld number would disclose the composition of a cohort whose
 * aggregate could not be safely computed.
 */
function Aggregate({ aggregate }: { aggregate: AggregateResult }) {
  return (
    <section className="mt-8 rounded-input border border-neutral-300/80 px-5 py-4 dark:border-white/15">
      <h2 className="text-title font-bold">
        {aggregate.visibility === "EXACT"
          ? new Intl.NumberFormat("en-US").format(aggregate.value ?? 0)
          : "Not available"}
      </h2>
      <p className="mt-1 text-copy">
        {aggregate.operation} of {aggregate.over.id}@{aggregate.over.version}
        {aggregate.basis ? ` over ${aggregate.basis.members} cohort member${aggregate.basis.members === 1 ? "" : "s"}` : ""}
      </p>
      {aggregate.visibility === "WITHHELD" && (
        <p className="mt-2 text-copy">This analysis isn&apos;t available for this cohort.</p>
      )}
      <p className="mt-3 text-body text-neutral-500 dark:text-neutral-400">
        {aggregate.aggregate.id}@{aggregate.aggregate.version} · {aggregate.provenance}
      </p>
    </section>
  );
}

/**
 * The explanation, inline and visible by default (ruling). A WITHHELD statement is shown exactly like
 * any other — hiding it behind a click would let absence read as zero, which is the failure this
 * slice exists to avoid. A statement whose existence was not authorized is not here to hide: the
 * renderer never built it.
 */
function ExplanationView({ explanation }: { explanation: Explanation }) {
  return (
    <section className="mt-8">
      <h2 className="text-title font-bold">Explanation</h2>
      <ul className="mt-4 space-y-2">
        {explanation.statements.map((s) => (
          <li key={s.ref} className="text-copy">
            <span>{s.text}</span>
            {"provenance" in s && (
              <span className="ml-2 text-body text-neutral-400 dark:text-neutral-500">({s.provenance})</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-body text-neutral-500 dark:text-neutral-400">
        {explanation.templateId}@{explanation.templateVersion} · plan v{explanation.planVersion} ·
        plan {explanation.planDigest} · computed at {explanation.computedAt}
      </p>
      <p className="mt-2 text-body">
        <a href="/experience/pursuits" className="text-accent underline">Back to the list</a>
      </p>
    </section>
  );
}

/** One cell. A suppressed cell has no value to render, because it was never given one. */
function Cell({ cell }: { cell: GovernedCell | undefined }) {
  if (!cell || cell.visibility === "SUPPRESSED") {
    return <span className="text-neutral-400 dark:text-neutral-500">not disclosable</span>;
  }
  const shown = cell.value === null ? "—" : String(cell.value);
  return (
    <span>
      {shown}
      {cell.visibility !== "EXACT" && (
        <span className="ml-1.5 text-body text-neutral-400 dark:text-neutral-500">({cell.visibility.toLowerCase()})</span>
      )}
    </span>
  );
}
