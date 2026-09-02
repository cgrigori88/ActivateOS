"use client";

import { useState } from "react";
import { buttonClass, fieldClass } from "@/components/ui";

/**
 * A suggested multi-vendor play, with the accounts individually selectable —
 * the same checkbox-picker grammar as list attach on campaigns. All accounts
 * start checked (the suggestion is the default), and the button always states
 * what it will create.
 */

export interface JointPlay {
  key: string;
  partners: { id: string; name: string; type: string | null; role: string }[];
  accounts: { companyId: string; name: string; score: number | null }[];
  avgScore: number | null;
  play: { name: string; objective: string | null; offer: string | null } | null;
  defaultName: string;
}

export function JointPlayCard({
  play: p,
  create,
}: {
  play: JointPlay;
  create: (fd: FormData) => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(p.accounts.map((a) => a.companyId)));
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="pos-card glass rounded-card p-5">
      {/* Who plays, in which role */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {p.partners.map((x) => (
          <span
            key={x.id}
            className="rounded-full bg-violet-50 px-2 py-0.5 text-label font-medium text-violet-800 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900"
            title={x.type ?? "partner"}
          >
            {x.name} <span className="font-normal opacity-60">{x.role.replace(/_/g, " ")}</span>
          </span>
        ))}
      </div>

      {/* The play being run */}
      {p.play && (
        <p className="mb-2 text-copy font-medium text-neutral-800 dark:text-neutral-200">
          {p.play.name}
          {p.play.offer && <span className="block text-body font-normal text-neutral-500">CTA: {p.play.offer}</span>}
        </p>
      )}

      {/* Accounts — individually selectable */}
      <div className="mb-3 max-h-40 overflow-y-auto rounded-inner border border-neutral-200 scroll-thin dark:border-neutral-800">
        {p.accounts.map((a) => (
          <label
            key={a.companyId}
            className="flex cursor-pointer items-center gap-2.5 border-b border-neutral-100 px-3 py-1.5 last:border-0 hover:bg-violet-50/50 dark:border-neutral-800 dark:hover:bg-violet-950/20"
          >
            <input type="checkbox" checked={sel.has(a.companyId)} onChange={() => toggle(a.companyId)} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-copy">{a.name}</span>
            <span className="tnum shrink-0 text-label text-neutral-400">{a.score != null ? `propensity ${a.score}` : "unscored"}</span>
          </label>
        ))}
      </div>

      <form action={create} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <input type="hidden" name="companyIds" value={[...sel].join(",")} />
        <input type="hidden" name="partners" value={p.partners.map((x) => `${x.id}:${x.role}`).join(",")} />
        <label className="text-copy">
          <span className="mb-1 block text-body text-neutral-500">Campaign name</span>
          <input name="name" defaultValue={p.defaultName} className={`${fieldClass("md")} w-64`} />
        </label>
        <button
          disabled={sel.size === 0}
          className={buttonClass("primary", "sm")}
        >
          Create joint campaign · {sel.size} account{sel.size === 1 ? "" : "s"}
        </button>
      </form>
    </div>
  );
}
