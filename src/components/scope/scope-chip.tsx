"use client";

import { usePathname, useRouter } from "next/navigation";
import { SCOPE_COOKIE, SCOPE_PARAM, type ScopeContext } from "@/lib/scope/scope";

/**
 * Persistent scope awareness (scale-disclosure §1.2 / R2). A quiet contextual chip shown beside
 * the page content whenever a non-default scope is active — "CDW · 6 accounts · 4 active motions".
 * Apple-esque, not a dashboard component. One-click ✕ returns to ALL. Renders nothing for ALL.
 */
export function ScopeChip({ active }: { active: ScopeContext }) {
  const router = useRouter();
  const pathname = usePathname();
  if (active.scope.kind === "ALL") return null;

  const clear = () => {
    try {
      document.cookie = `${SCOPE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    } catch {
      /* non-fatal */
    }
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    params.delete(SCOPE_PARAM);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="mb-3 flex items-center gap-2 text-body text-neutral-500">
      <span
        className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1 pr-1"
        style={{ background: "color-mix(in srgb, var(--color-accent) 8%, transparent)" }}
      >
        <span className="ml-1 h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-accent)" }} aria-hidden />
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">{active.label}</span>
        {active.facts.length > 0 && (
          <span className="text-neutral-400">· {active.facts.join(" · ")}</span>
        )}
        <button
          type="button"
          onClick={clear}
          aria-label="Clear scope"
          title="Clear scope — back to all ecosystems"
          className="ml-0.5 grid h-4 w-4 place-items-center rounded-full text-neutral-400 hover:bg-neutral-900/[0.06] hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
        >
          <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </span>
      <span className="text-neutral-400">operating scope</span>
    </div>
  );
}
