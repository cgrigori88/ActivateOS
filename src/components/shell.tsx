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
        className={`group relative flex min-h-[34px] items-center gap-2.5 rounded-control px-2.5 py-[7px] text-[13px] transition-colors duration-[140ms] ${
          active
            ? "bg-accent-wash font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
        }`}
      >
        {/* The accent marks one thing on the screen, and this is it. */}
        {active && (
          <span className="absolute -left-2.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
        )}
        <span
          className={
            active
              ? "shrink-0 text-blue-600 dark:text-blue-400"
              : "shrink-0 text-neutral-400 transition-colors duration-[140ms] group-hover:text-neutral-600 dark:group-hover:text-neutral-300"
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
          <Link href="/" aria-label="PursuitOS home" className="text-accent">
            <Mark size={22} />
          </Link>
        ) : (
          <Wordmark />
        )}
      </div>
      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3.5 pb-4">
        {NAV.map((group, i) => (
          <div key={i}>
            {group.label && !collapsed && (
              <p className="mb-1.5 px-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-neutral-400">
                {group.label}
              </p>
            )}
            {group.label && collapsed && <div className="mx-2 mb-2 h-px bg-neutral-200 dark:bg-neutral-800" />}
            <div className="space-y-0.5">{group.items.map((item) => link(item))}</div>
          </div>
        ))}
      </nav>
      <div className={`border-t border-neutral-100 px-4 py-3.5 dark:border-neutral-800 ${collapsed ? "text-center" : ""}`}>
        {collapsed ? (
          <span className="text-[10px] font-bold text-neutral-400" title="Design Partner Demo">DP</span>
        ) : (
          <>
            <p className="text-[11.5px] font-semibold text-neutral-500 dark:text-neutral-400">
              Design Partner Demo
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
              Partner revenue graph
            </p>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop rail — 240 collapses to 64. */}
      <aside
        className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-neutral-200 bg-white transition-[width] duration-[220ms] md:flex dark:border-neutral-800 dark:bg-neutral-900 ${
          collapsed ? "w-[64px]" : "w-[240px]"
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
            className="absolute inset-0 bg-neutral-950/50"
            onClick={() => setDrawer(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-neutral-200 bg-white shadow-[var(--shadow-pop)] dark:border-neutral-800 dark:bg-neutral-900">
            {railBody}
          </aside>
        </div>
      )}

      <div className={collapsed ? "md:pl-[64px]" : "md:pl-[240px]"}>
        <div className="sticky top-0 z-30 flex min-h-[56px] items-center gap-2 border-b border-neutral-200 bg-neutral-50/85 px-4 backdrop-blur sm:px-6 dark:border-neutral-800 dark:bg-neutral-950/85">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-control text-neutral-600 transition-colors duration-[140ms] hover:bg-neutral-100 md:hidden dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}><path d="M2 4h12M2 8h12M2 12h12" /></svg>
          </button>
          <button
            type="button"
            onClick={toggleRail}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
            className="hidden h-9 w-9 items-center justify-center rounded-control text-neutral-500 transition-colors duration-[140ms] hover:bg-neutral-100 md:inline-flex dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
              <rect x="2" y="3" width="12" height="10" rx="2" />
              <path d="M6.5 3v10" />
            </svg>
          </button>
          <span className="md:hidden"><Wordmark /></span>
        </div>

        <div className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
