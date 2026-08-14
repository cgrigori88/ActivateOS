"use client";

import { useMemo, useState } from "react";

/**
 * CC picker for a touch: the account's known contacts as searchable checkbox
 * rows, plus a free-entry line for addresses the system doesn't know yet.
 * Emits ONE hidden `cc` input (comma-joined), so the server action's parsing
 * is unchanged — this is purely a better way to build the same value.
 */

export interface CcContact {
  email: string;
  name: string | null;
  title: string | null;
}

export function CcPicker({ contacts, defaultCc }: { contacts: CcContact[]; defaultCc: string[] }) {
  const known = useMemo(() => new Set(contacts.map((c) => c.email.toLowerCase())), [contacts]);
  const [sel, setSel] = useState<Set<string>>(new Set(defaultCc.filter((e) => known.has(e))));
  const [extra, setExtra] = useState(defaultCc.filter((e) => !known.has(e)).join(", "));
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      contacts.filter(
        (c) =>
          !q ||
          c.email.toLowerCase().includes(q.toLowerCase()) ||
          (c.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
          (c.title ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
    [contacts, q],
  );

  const toggle = (email: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(email)) n.delete(email);
      else n.add(email);
      return n;
    });

  const value = [...sel, ...extra.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean)].join(", ");
  const count = value ? value.split(",").filter(Boolean).length : 0;

  return (
    <div>
      <span className="mb-1 block text-xs text-neutral-500">
        CC — additional contacts copied on this touch{count > 0 ? ` (${count})` : ""}; the primary recipient stays the sequence target
      </span>
      <input type="hidden" name="cc" value={value} />
      {contacts.length > 0 && (
        <>
          {contacts.length > 5 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contacts"
              className="mb-1.5 w-56 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          )}
          <div className="mb-1.5 max-h-36 overflow-y-auto rounded-lg border border-neutral-200 scroll-thin dark:border-neutral-800">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-neutral-400">No contacts match.</p>
            ) : (
              filtered.map((c) => (
                <label
                  key={c.email}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-neutral-100 px-3 py-1.5 last:border-0 hover:bg-blue-50/50 dark:border-neutral-800 dark:hover:bg-blue-950/20"
                >
                  <input type="checkbox" checked={sel.has(c.email.toLowerCase())} onChange={() => toggle(c.email.toLowerCase())} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{c.name ?? c.email}</span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {c.email}
                      {c.title ? ` · ${c.title}` : ""}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </>
      )}
      <input
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        placeholder={contacts.length > 0 ? "Other addresses (comma-separated)" : "champion@account.com, seller@partner.com"}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      />
    </div>
  );
}
