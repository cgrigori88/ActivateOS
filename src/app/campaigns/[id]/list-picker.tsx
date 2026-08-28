"use client";

import { useMemo, useState } from "react";

/**
 * Attach target lists to a campaign — a real picker, not a Ctrl/Cmd select.
 * Checkbox rows (several lists is the normal case, so multi-select is the
 * default affordance), with search, category filter and sort, because an org
 * that imports partner books ends up with dozens of lists fast.
 */

export interface PickableList {
  populationId: string;
  name: string;
  category: string;
  partnerName: string | null;
  members: number;
  avgScore: number | null;
  overlap: number;
  reason: string;
}

const input = "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function ListPicker({
  lists,
  attach,
}: {
  lists: PickableList[];
  attach: (fd: FormData) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<"fit" | "members" | "name">("fit");
  const [sel, setSel] = useState<Set<string>>(new Set());

  const categories = useMemo(() => [...new Set(lists.map((l) => l.category))].sort(), [lists]);

  const filtered = useMemo(() => {
    const f = lists.filter(
      (l) =>
        (category === "all" || l.category === category) &&
        (!q ||
          l.name.toLowerCase().includes(q.toLowerCase()) ||
          (l.partnerName ?? "").toLowerCase().includes(q.toLowerCase())),
    );
    return [...f].sort((a, b) =>
      sort === "fit"
        ? (b.avgScore ?? -1) - (a.avgScore ?? -1)
        : sort === "members"
          ? b.members - a.members
          : a.name.localeCompare(b.name),
    );
  }, [lists, q, category, sort]);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="w-full max-w-xl">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Add lists</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search list / partner" className={`${input} w-44`} />
        {categories.length > 1 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
            <option value="all">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={input}>
          <option value="fit">Sort: fit</option>
          <option value="members">Sort: members</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-neutral-200 scroll-thin dark:border-neutral-800">
        {filtered.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-neutral-400">No lists match.</p>
        ) : (
          filtered.map((l) => (
            <label
              key={l.populationId}
              className="flex cursor-pointer items-center gap-2.5 border-b border-neutral-100 px-3 py-2 last:border-0 hover:bg-blue-50/50 dark:border-neutral-800 dark:hover:bg-blue-950/20"
            >
              <input
                type="checkbox"
                checked={sel.has(l.populationId)}
                onChange={() => toggle(l.populationId)}
                className="h-4 w-4 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{l.name}</span>
                <span className="block truncate text-label text-neutral-500">{l.reason}</span>
              </span>
              <span className="tnum shrink-0 text-label text-neutral-400">
                {l.members} acct{l.members === 1 ? "" : "s"}
                {l.avgScore != null && <> · fit {l.avgScore}</>}
              </span>
            </label>
          ))
        )}
      </div>

      <form action={attach} className="mt-2 flex items-center gap-3">
        {[...sel].map((id) => (
          <input key={id} type="hidden" name="populationId" value={id} />
        ))}
        <button
          disabled={sel.size === 0}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Attach {sel.size > 0 ? `${sel.size} list${sel.size === 1 ? "" : "s"}` : "lists"}
        </button>
        <span className="text-label text-neutral-400">{sel.size === 0 ? "check the lists to add" : "nothing sends until you approve each touch"}</span>
      </form>
    </div>
  );
}
