"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Lockup, Mark } from "@/components/brand";

/**
 * Application shell: grouped left sidebar on desktop, horizontal nav on
 * mobile — the decision-cockpit IA from BLUEPRINT §56, scoped to the
 * surfaces that exist today.
 */

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}
interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const icons = {
  today: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 2v2M10.5 2v2" />
    </svg>
  ),
  accounts: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M2 14V5l4-2.5V14M6 14V7l4-2v9M10 14V8l4-1.5V14" />
    </svg>
  ),
  sources: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  ),
  review: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4l5-2z" />
      <path d="M6 8l1.5 1.5L10.5 6.5" />
    </svg>
  ),
  motions: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M2 8h8M8 4l4 4-4 4" />
    </svg>
  ),
  queue: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M3 4h10M3 8h10M3 12h6" />
      <circle cx="13" cy="12" r="1.4" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M2 13V8M6 13V5M10 13V7M14 13V3" />
    </svg>
  ),
  insights: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 8V3.5M8 8l3 2.5" />
    </svg>
  ),
  providerHealth: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M2 8h3l1.5-3.5L9 12l1.5-4H14" />
    </svg>
  ),
  intake: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M8 2v7M5 6l3 3 3-3M3 12h10" />
    </svg>
  ),
  mapping: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="4" r="2" />
      <path d="M4 6v4a2 2 0 002 2h4M12 6v4" />
    </svg>
  ),
};

const NAV: NavGroup[] = [
  { label: null, items: [{ href: "/", label: "Today", icon: icons.today }] },
  {
    label: "Ecosystem",
    items: [
      { href: "/intake", label: "Intake", icon: icons.intake },
      { href: "/mapping", label: "Mapping", icon: icons.mapping },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/accounts", label: "Accounts", icon: icons.accounts },
      { href: "/sources", label: "Sources", icon: icons.sources },
      { href: "/provider-health", label: "Provider health", icon: icons.providerHealth },
      { href: "/review", label: "Review", icon: icons.review },
    ],
  },
  {
    label: "Execution",
    items: [
      { href: "/motions", label: "Motions", icon: icons.motions },
      { href: "/queue", label: "Queue", icon: icons.queue },
    ],
  },
  {
    label: "Revenue",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: icons.pipeline },
      { href: "/insights", label: "Insights", icon: icons.insights },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center">
      <Lockup size={15} />
    </Link>
  );
}

/** Public marketing surfaces render without the app chrome. */
const CHROMELESS = ["/landing"];

const STORAGE_KEY = "pursuitos:rail-collapsed";

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // Restore the rail width the operator left it at.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — the default width is fine */
    }
  }, []);

  const toggleRail = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  // "[" toggles the rail from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      if (e.key === "[") {
        e.preventDefault();
        toggleRail();
      }
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleRail]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  if (CHROMELESS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <>{children}</>;
  }

  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex min-h-[38px] items-center gap-3 rounded-full px-3 py-[8px] text-[13.5px] transition-colors duration-[140ms] ${
          active
            ? "bg-white/[0.14] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            : "font-medium text-rail-ink-soft hover:bg-white/[0.07] hover:text-rail-ink"
        }`}
      >
        {/* The accent marks one thing on the screen, and this is it. */}
        {active && !collapsed && (
          <span className="absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent-tint" />
        )}
        <span
          className={
            active
              ? "shrink-0 text-accent-tint"
              : "shrink-0 text-rail-ink-soft/70 transition-colors duration-[140ms] group-hover:text-rail-ink"
          }
        >
          {item.icon}
        </span>
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
      </Link>
    );
  };

  const railBody = (
    <>
      <div className={`flex min-h-[60px] items-center px-4 py-4 ${collapsed ? "justify-center" : ""}`}>
        {collapsed ? (
          <Link href="/" aria-label="PursuitOS home" className="text-accent-tint">
            <Mark size={22} />
          </Link>
        ) : (
          <Link href="/" className="flex items-center text-rail-ink">
            <Lockup size={16} markClass="text-accent-tint" />
          </Link>
        )}
      </div>
      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 pb-4">
        {NAV.map((group, i) => (
          <div key={i}>
            {group.label && !collapsed && (
              <p className="mb-2 px-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-rail-ink-soft/60">
                {group.label}
              </p>
            )}
            {group.label && collapsed && <div className="mx-3 mb-2 h-px bg-white/[0.07]" />}
            <div className="space-y-0.5">{group.items.map((item) => link(item))}</div>
          </div>
        ))}
      </nav>
      <div className={`border-t border-white/[0.07] px-4 py-3.5 ${collapsed ? "text-center" : ""}`}>
        {collapsed ? (
          <span className="text-[10px] font-bold text-rail-ink-soft" title="Design Partner Demo">DP</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">
              DP
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-semibold text-rail-ink">
                Design Partner Demo
              </span>
              <span className="block truncate text-[11px] text-rail-ink-soft">
                Partner revenue graph
              </span>
            </span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop rail — 240 collapses to 64. */}
      <aside
        className={`glass-rail fixed bottom-3 left-3 top-3 z-20 hidden flex-col overflow-hidden rounded-panel text-rail-ink transition-[width] duration-[220ms] md:flex ${
          collapsed ? "w-[68px]" : "w-[236px]"
        }`}
      >
        {railBody}
      </aside>

      {/* Mobile drawer. 64px of icons fails the 44px touch target, so small
          screens get the full rail over a scrim instead of a narrow one. */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
          />
          <aside className="glass-rail absolute bottom-3 left-3 top-3 flex w-[264px] flex-col overflow-hidden rounded-panel text-rail-ink">
            {railBody}
          </aside>
        </div>
      )}

      <div className={collapsed ? "md:pl-[92px]" : "md:pl-[260px]"}>
        {/* Mobile keeps a bar because it carries the menu and the wordmark. On
            desktop the only global control is the rail toggle, and a full-width
            slab holding one button reads as hollow — so it floats instead. */}
        <div className="glass sticky top-3 z-30 mx-3 mt-3 flex min-h-[52px] items-center gap-2 rounded-card px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 transition-colors duration-[140ms] hover:bg-neutral-900/6"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}><path d="M2 4h12M2 8h12M2 12h12" /></svg>
          </button>
          <Wordmark />
        </div>

        <button
          type="button"
          onClick={toggleRail}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
          className="glass fixed top-4 z-30 hidden h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-[left,color] duration-[220ms] hover:text-neutral-900 md:inline-flex"
          style={{ left: collapsed ? 104 : 272 }}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
            <rect x="2" y="3" width="12" height="10" rx="2" />
            <path d="M6.5 3v10" />
          </svg>
        </button>

        <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-4 sm:px-6 md:pt-16 lg:px-7">{children}</div>
      </div>
    </div>
  );
}
