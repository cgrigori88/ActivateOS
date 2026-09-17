import { notFound } from "next/navigation";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { executePursuitQuery } from "@/lib/experience/execute";
import { explainPlanFor, isViewKey, PLANS, VIEW_KEYS, type ViewKey } from "@/lib/experience/plans";
import { FIELDS, METRICS, metricKey } from "@/lib/experience/registry";
import type { Explanation, GovernedCell, GovernedResultSet } from "@/lib/experience/types";

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
  searchParams: Promise<{ view?: string; explain?: string }>;
}) {
  if (!pursuitExperienceEnabled()) notFound();   // deployment master — fast deny, no DB work

  const sp = await searchParams;
  const view: ViewKey = isViewKey(sp.view) ? sp.view : "open-by-value";
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
        <Result result={outcome.result} view={view} />
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
