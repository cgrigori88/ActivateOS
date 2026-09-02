import Link from "next/link";
import type { StakeholderCoverage, RoleCoverage, WarmPathStatement } from "@/lib/stakeholders/coverage";
import { bestWarmPath, ROLE_WORD } from "@/lib/stakeholders/coverage";
import { assertStakeholderAction } from "@/app/pursuits/[id]/actions";
import { usd } from "@/components/intel/constraint-language";
import { buttonClass } from "@/components/ui";

/**
 * Stakeholder Intelligence panel (P1C §5/§16/§17). The hero is COVERAGE — roles and their
 * assertion states, not an address book: dozens of contacts collapse to a handful of role rows.
 * "Who are we missing?" is the primary interaction: each missing/uncertain role expands to why it
 * matters, candidates, the strongest evidence-backed warm path (or UNKNOWN), what evidence would
 * verify it, and the governed assertion form. Every line traces to canonical records; nothing is
 * synthesized to complete the picture.
 */

const STATE_META: Record<string, { label: string; hue: string }> = {
  VERIFIED: { label: "verified", hue: "var(--color-accent-verified)" },
  INFERRED: { label: "inferred", hue: "var(--color-accent-violet, #7c3aed)" },
  UNVERIFIED: { label: "unverified", hue: "var(--color-neutral-500, #737373)" },
  MISSING: { label: "missing", hue: "var(--color-accent-risk)" },
};

function StateChip({ state }: { state: string }) {
  const m = STATE_META[state] ?? STATE_META.UNVERIFIED;
  return (
    <span className="rounded-full px-2 py-px text-micro font-bold" style={{ color: m.hue, background: `color-mix(in srgb, ${m.hue} 12%, transparent)` }}>
      {m.label}
    </span>
  );
}

function PathLine({ p }: { p: WarmPathStatement }) {
  const head = p.tier === "UNKNOWN" ? "Best known path: UNKNOWN"
    : p.tier === "PERSON_VERIFIED" ? "Verified person-level path"
    : p.tier === "SELLER_ACCOUNT" ? "Strongest known path" : "Overlap only";
  return (
    <p className="text-body text-neutral-600 dark:text-neutral-300">
      <span className="font-semibold">{head}</span>
      <span className="text-neutral-500"> — {p.text}</span>
    </p>
  );
}

function AssertForm({ pursuitId, opportunityId, role, contacts, canDecide }: {
  pursuitId: string; opportunityId: string; role: string;
  contacts: { id: string; name: string | null; title: string | null }[]; canDecide: boolean;
}) {
  if (!canDecide) return null;
  if (contacts.length === 0) return <p className="text-label text-neutral-400">No captured contacts on this account yet — Contacts is where people come from; nothing is invented here.</p>;
  return (
    <form action={assertStakeholderAction.bind(null, pursuitId)} className="mt-1.5 flex flex-wrap items-end gap-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="role" value={role} />
      <label className="text-label text-neutral-500">
        <span className="mb-0.5 block">Person</span>
        <select name="contactId" className="rounded-control border border-neutral-300 bg-white px-2 py-1 text-body dark:border-neutral-700 dark:bg-neutral-900">
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name ?? "—"}{c.title ? ` · ${c.title}` : ""}</option>)}
        </select>
      </label>
      <label className="text-label text-neutral-500">
        <span className="mb-0.5 block">Assertion</span>
        <select name="assertionState" defaultValue="unverified" className="rounded-control border border-neutral-300 bg-white px-2 py-1 text-body dark:border-neutral-700 dark:bg-neutral-900">
          <option value="verified">verified — evidence confirms it</option>
          <option value="inferred">inferred — signals suggest it</option>
          <option value="unverified">unverified — a proposal</option>
        </select>
      </label>
      <label className="min-w-52 flex-1 text-label text-neutral-500">
        <span className="mb-0.5 block">Evidence (required to verify — a title alone is never enough)</span>
        <input name="evidence" placeholder="e.g. confirmed budget ownership on the 14 Mar call" className="w-full rounded-control border border-neutral-300 bg-white px-2 py-1 text-body dark:border-neutral-700 dark:bg-neutral-900" />
      </label>
      <button className={buttonClass("primary", "sm")}>
        Assert role
      </button>
    </form>
  );
}

function RoleRow({ r, c, pursuitId, canDecide, contacts }: {
  r: RoleCoverage; c: StakeholderCoverage; pursuitId: string; canDecide: boolean;
  contacts: { id: string; name: string | null; title: string | null }[];
}) {
  const best = bestWarmPath(c.warmPaths);
  return (
    <details className="group rounded-card" style={{ background: r.state === "MISSING" ? "color-mix(in srgb, var(--color-accent-risk) 5%, transparent)" : undefined }}>
      <summary className="flex cursor-pointer items-baseline gap-2.5 rounded-card px-2.5 py-1.5 hover:bg-neutral-900/[0.03] dark:hover:bg-white/[0.05]">
        <span className="w-36 shrink-0 text-body font-semibold capitalize">{ROLE_WORD(r.role)}</span>
        <StateChip state={r.state} />
        <span className="min-w-0 flex-1 truncate text-body text-neutral-600 dark:text-neutral-300">
          {r.person ? <>{r.person.name}{r.person.title && <span className="text-neutral-400"> · {r.person.title} <span className="text-micro">(title = context, not authority)</span></span>}</> : <span className="text-neutral-400">no one identified</span>}
        </span>
      </summary>
      {/* The contextual drawer (§16): why it matters, candidates, path, evidence, governed action. */}
      <div className="space-y-1.5 px-2.5 pb-2.5 pt-1 text-body">
        <p className="text-neutral-500"><b className="text-neutral-700 dark:text-neutral-200">Why this matters:</b> {r.whyItMatters}</p>
        {r.source && <p className="text-neutral-500"><b className="text-neutral-700 dark:text-neutral-200">Source:</b> {r.source}{r.assertedAt && ` · ${r.assertedAt.slice(0, 10)}`}</p>}
        {r.candidates.length > 0 && (
          <p className="text-neutral-500"><b className="text-neutral-700 dark:text-neutral-200">Also asserted:</b> {r.candidates.map((p) => p.name ?? "—").join(", ")}</p>
        )}
        {r.state !== "VERIFIED" && (
          <>
            <p className="text-neutral-500"><b className="text-neutral-700 dark:text-neutral-200">What would verify it:</b> {r.verifyingEvidence}</p>
            <PathLine p={best} />
            <AssertForm pursuitId={pursuitId} opportunityId={c.opportunityIds[0]} role={r.role} contacts={contacts} canDecide={canDecide} />
          </>
        )}
      </div>
    </details>
  );
}

export function StakeholderPanel({ c, pursuitId, accountLabel, canDecide, contacts }: {
  c: StakeholderCoverage; pursuitId: string; accountLabel: string; canDecide: boolean;
  contacts: { id: string; name: string | null; title: string | null }[];
}) {
  if (!c.established) {
    return (
      <div className="space-y-2">
        <p className="text-body text-neutral-500">{c.notEstablishedReason}</p>
        {/* Warm-path intelligence still renders — it is account-level evidence, not stakeholder state. */}
        <PathLine p={bestWarmPath(c.warmPaths)} />
      </div>
    );
  }

  const missing = c.roles.filter((r) => r.state === "MISSING");
  const uncertain = c.roles.filter((r) => r.state === "INFERRED" || r.state === "UNVERIFIED");
  const best = bestWarmPath(c.warmPaths);

  return (
    <div className="space-y-3">
      {/* ── The signature moment (§17): who are we missing, and what changes it ── */}
      {missing.length > 0 && (
        <div className="rounded-card p-3" style={{ background: "color-mix(in srgb, var(--color-accent-risk) 6%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-risk) 20%, transparent)" }}>
          <p className="text-copy">
            <b>{accountLabel} is missing {missing.map((r) => ROLE_WORD(r.role)).join(" and ")}</b>
            {c.expectedValue != null && <span className="text-neutral-500"> — {usd(c.expectedValue)} in play without verified buying authority.</span>}
          </p>
          <div className="mt-1.5"><PathLine p={best} /></div>
          <p className="mt-1 text-body text-neutral-500">
            <b className="text-neutral-700 dark:text-neutral-200">Next:</b>{" "}
            {/* A partner is named ONLY when the tier is an actual relationship. Overlap (and the
                absence of evidence) is discovery — naming a partner there would be exactly the
                "they own the account, so they must know the buyer" inference the model forbids. */}
            {best.tier === "PERSON_VERIFIED" || best.tier === "SELLER_ACCOUNT"
              ? `Validate the ${ROLE_WORD(missing[0].role)}${best.via ? ` through ${best.via}` : ""} — then verify with their confirmation, not a title.`
              : best.tier === "ACCOUNT_OVERLAP"
                ? `Identify the ${ROLE_WORD(missing[0].role)} — only account overlap exists here, which is not a path to a person. Establish a seller-level relationship or ask directly.`
                : `Identify the ${ROLE_WORD(missing[0].role)} — no warm path is known, so this starts with discovery, not an introduction.`}
          </p>
        </div>
      )}

      {/* ── Buying team coverage — roles, not cards ── */}
      <div className="space-y-0.5">
        {c.roles.map((r) => (
          <RoleRow key={r.role} r={r} c={c} pursuitId={pursuitId} canDecide={canDecide} contacts={contacts} />
        ))}
      </div>

      {c.activeBlocker && (
        <p className="text-body" style={{ color: "var(--color-accent-risk)" }}>
          Active blocker: <b>{c.activeBlocker.name}</b>{c.activeBlocker.title && <span className="text-neutral-500"> · {c.activeBlocker.title}</span>} — sentiment {c.activeBlocker.sentiment}.
        </p>
      )}

      {uncertain.length > 0 && missing.length === 0 && (
        <p className="text-label text-neutral-500">
          {uncertain.length} role{uncertain.length === 1 ? "" : "s"} below verified — expand a row for what would verify it.
        </p>
      )}

      {c.others.length > 0 && (
        <details>
          <summary className="cursor-pointer text-label font-medium text-neutral-500 hover:underline">
            {c.others.length} further stakeholder{c.others.length === 1 ? "" : "s"} on record
          </summary>
          <ul className="mt-1 space-y-0.5 text-body text-neutral-500">
            {c.others.map((o, i) => (
              <li key={i}>{o.person.name ?? "—"} — {ROLE_WORD(o.role)} · {o.state.toLowerCase()}{o.person.title && ` · ${o.person.title}`}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Assertion history — append-only; a superseded assertion stays visible forever. */}
      {c.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-label font-medium text-neutral-500 hover:underline">Assertion history ({c.history.length})</summary>
          <ul className="mt-1 space-y-0.5 text-label text-neutral-500">
            {c.history.map((h, i) => (
              <li key={i}><span className="tnum text-neutral-400">{h.at.slice(0, 10)}</span> · {h.reason ?? "assertion"}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-micro text-neutral-400">
        Coverage reads the canonical stakeholder assertions on this pursuit&rsquo;s linked opportunit{c.opportunityIds.length === 1 ? "y" : "ies"} — verified / inferred / unverified stay distinct, and{" "}
        <Link href="/contacts" className="hover:underline">Contacts</Link> remains the directory. Assertions are governed (assert_stakeholder_role); titles are context, never authority.
      </p>
    </div>
  );
}
