"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SCOPE_COOKIE,
  SCOPE_PARAM,
  serializeScope,
  scopesEqual,
  type Scope,
  type ScopeOption,
} from "@/lib/scope/scope";

/**
 * Persistent ecosystem scope selector (scale-disclosure §1). Lives in the rail so it is present
 * in every room. Choosing a scope (a) persists it in a cookie so plain rail navigations keep it,
 * and (b) writes `?scope=` on the current path so the view is shareable/bookmarkable. The server
 * always re-authorizes — this control only narrows, never widens.
 *
 * Calm by default: collapsed it's a single quiet line; ALL shows no emphasis.
 */
export function ScopeSelector({ options, active, collapsed }: { options: ScopeOption[]; active: Scope; collapsed?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const current = useMemo(() => options.find((o) => o.kind === active.kind && o.id === active.id), [options, active]);
  const currentLabel = current?.label ?? (active.kind === "ALL" ? "All" : active.kind.toLowerCase());
  const isAll = active.kind === "ALL";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (opt: ScopeOption) => {
    const scope: Scope = { kind: opt.kind, id: opt.id };
    setOpen(false);
    const token = serializeScope(scope);
    // Persist for plain rail navigations that don't carry the param.
    try {
      document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    } catch {
      /* non-fatal */
    }
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (scope.kind === "ALL") params.delete(SCOPE_PARAM);
    else params.set(SCOPE_PARAM, token);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  // Group options for the menu (ALL first, then by kind group).
  const groups = useMemo(() => {
    const g = new Map<string, ScopeOption[]>();
    for (const o of options) {
      if (o.kind === "ALL") continue;
      const list = g.get(o.group) ?? [];
      list.push(o);
      g.set(o.group, list);
    }
    return [...g.entries()];
  }, [options]);

  const allOpt = options.find((o) => o.kind === "ALL") ?? { kind: "ALL" as const, id: null, label: "All (my authorized set)", group: "" };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? `Scope: ${currentLabel}` : "Ecosystem scope"}
        aria-label={`Ecosystem scope — ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full min-h-[34px] items-center gap-2 rounded-full px-3 py-[6px] text-body font-medium transition-colors duration-[140ms] hover:bg-white/[0.07] ${
          isAll ? "text-rail-ink-soft" : "text-rail-ink"
        } ${collapsed ? "justify-center" : ""}`}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <path d="M2.5 8h11M8 2.2c1.7 1.6 2.6 3.7 2.6 5.8s-.9 4.2-2.6 5.8C6.3 12.2 5.4 10.1 5.4 8S6.3 3.8 8 2.2z" />
        </svg>
        {!collapsed && (
          <>
            <span className="truncate">
              {isAll ? <span className="text-rail-ink-soft">All ecosystems</span> : currentLabel}
            </span>
            {!isAll && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent-tint" aria-hidden />}
            <svg viewBox="0 0 16 16" className={`h-3 w-3 shrink-0 text-rail-ink-soft/70 ${isAll ? "ml-auto" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </>
        )}
        {collapsed && !isAll && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-tint" aria-hidden />}
      </button>

      {open && (
        <div
          role="listbox"
          className="pos-rail-scroll absolute left-0 right-0 z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-card p-1.5 text-rail-ink"
          style={{ minWidth: 220, background: "var(--rail-pop-bg)", boxShadow: "var(--shadow-rail)", border: "1px solid var(--rail-pop-edge)" }}
        >
          <MenuItem opt={allOpt} active={scopesEqual(active, { kind: "ALL", id: null })} onPick={apply} />
          {groups.length === 0 && (
            <p className="px-3 py-2 text-[11.5px] text-rail-ink-soft/70">No narrower scopes in this tenant yet.</p>
          )}
          {groups.map(([group, items]) => (
            <div key={group} className="mt-1">
              <p className="mb-0.5 mt-1 px-3 text-micro font-bold uppercase tracking-[0.12em] text-rail-ink-soft/60">{group}</p>
              {items.map((o) => (
                <MenuItem key={`${o.kind}:${o.id}`} opt={o} active={scopesEqual(active, { kind: o.kind, id: o.id })} onPick={apply} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ opt, active, onPick }: { opt: ScopeOption; active: boolean; onPick: (o: ScopeOption) => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onPick(opt)}
      className={`flex w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-[13px] transition-colors duration-[100ms] ${
        active ? "bg-accent font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "text-rail-ink-soft hover:bg-[var(--rail-pop-hover)] hover:text-rail-ink"
      }`}
    >
      <span className="truncate">{opt.label}</span>
      {active && <span className="ml-auto shrink-0 text-micro text-white/90">✓</span>}
    </button>
  );
}
