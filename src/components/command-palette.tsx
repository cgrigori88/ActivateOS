"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * ⌘K command palette (#78): one box that reaches every room and every entity.
 * Rooms are static and filter instantly; entities (accounts, campaigns,
 * motions, partners, joint pursuits) stream in from /api/palette, org-scoped
 * server-side. Mounted fresh on each open so state never leaks between uses.
 */

interface Hit {
  group: string;
  label: string;
  sub: string | null;
  href: string;
}

/* Every destination, including rooms that live as tabs rather than rail items
   (Queue, Scheduled sends, Provider health) — the palette is how the merged
   rooms stay one keystroke away. */
const ROOMS: Hit[] = [
  { group: "Rooms", label: "Today", sub: "decisions ranked", href: "/" },
  { group: "Rooms", label: "Queue", sub: "dated worklist", href: "/queue" },
  { group: "Rooms", label: "Review", sub: "evidence triage", href: "/review" },
  { group: "Rooms", label: "Motions", sub: "revenue plays", href: "/motions" },
  { group: "Rooms", label: "Intake", sub: "bring a book in", href: "/intake" },
  { group: "Rooms", label: "Mapping", sub: "overlap workbench", href: "/mapping" },
  { group: "Rooms", label: "Accounts", sub: "the market map", href: "/accounts" },
  { group: "Rooms", label: "Contacts", sub: "buying committees", href: "/contacts" },
  { group: "Rooms", label: "Campaigns", sub: "outreach sequences", href: "/campaigns" },
  { group: "Rooms", label: "Scheduled sends", sub: "the dated send plan", href: "/upcoming" },
  { group: "Rooms", label: "Joint pursuits", sub: "co-sell rooms", href: "/joint" },
  { group: "Rooms", label: "Pipeline", sub: "opportunities", href: "/pipeline" },
  { group: "Rooms", label: "Goals", sub: "targets", href: "/goals" },
  { group: "Rooms", label: "Analytics", sub: "outreach performance", href: "/analytics" },
  { group: "Rooms", label: "Insights", sub: "AI calibration", href: "/insights" },
  { group: "Rooms", label: "Intelligence — sources", sub: "earned trust per source", href: "/sources" },
  { group: "Rooms", label: "Intelligence — providers", sub: "provider health", href: "/provider-health" },
  { group: "Rooms", label: "Routines", sub: "briefs & digests", href: "/routines" },
  { group: "Rooms", label: "Admin", sub: "partnerships & governance", href: "/admin" },
];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rooms = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ROOMS;
    return ROOMS.filter((r) => r.label.toLowerCase().includes(needle) || (r.sub ?? "").includes(needle));
  }, [q]);

  // Entities follow the keystrokes with a short debounce; stale responses are
  // dropped by comparing the query they were asked for.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/palette?q=${encodeURIComponent(needle)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { results: Hit[] };
        setHits((prev) => (inputRef.current?.value.trim() === needle ? data.results : prev));
      } catch {
        /* transient — keep whatever is on screen */
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const flat = useMemo(() => [...hits, ...rooms], [hits, rooms]);
  useEffect(() => setSel(0), [q, hits.length]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    onClose();
    router.push(hit.href);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the selected row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[sel]);
    }
  };

  // Group headers render once, at each group's first row of the flat list.
  const headerFor = (i: number) => (i === 0 || flat[i].group !== flat[i - 1].group ? flat[i].group : null);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search">
      <button
        aria-label="Close search"
        className="absolute inset-0 bg-neutral-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="absolute left-1/2 top-[14vh] w-[min(600px,92vw)] -translate-x-1/2 overflow-hidden rounded-card bg-white shadow-[var(--shadow-float,0_18px_50px_rgba(0,0,0,0.28))] ring-1 ring-neutral-950/10 dark:bg-neutral-900 dark:ring-white/10"
        onKeyDown={onKey}
      >
        <div className="relative border-b border-neutral-950/[0.07] dark:border-white/10">
          <svg
            viewBox="0 0 16 16"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts, campaigns, partners… or jump to a room"
            className="w-full bg-transparent py-3.5 pl-11 pr-14 text-[14.5px] outline-none placeholder:text-neutral-400"
            aria-label="Search"
          />
          <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-neutral-300/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400 dark:border-white/15">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2 scroll-thin">
          {flat.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-neutral-400">
              Nothing matches “{q}” — accounts, campaigns, motions, partners and joint pursuits are searchable.
            </p>
          )}
          {flat.map((hit, i) => (
            <div key={`${hit.href}-${hit.group}-${i}`}>
              {headerFor(i) && (
                <p className="mb-0.5 mt-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400 first:mt-1">
                  {headerFor(i)}
                </p>
              )}
              <button
                type="button"
                data-idx={i}
                onClick={() => go(hit)}
                onMouseMove={() => setSel(i)}
                className={`flex w-full items-baseline gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors duration-[100ms] ${
                  i === sel
                    ? "bg-accent text-white"
                    : "text-neutral-800 dark:text-neutral-200"
                }`}
              >
                <span className="truncate font-semibold">{hit.label}</span>
                {hit.sub && (
                  <span className={`truncate text-[11.5px] ${i === sel ? "text-white/70" : "text-neutral-400"}`}>
                    {hit.sub}
                  </span>
                )}
                {i === sel && <span className="ml-auto shrink-0 font-mono text-[10px] text-white/70">↵</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
