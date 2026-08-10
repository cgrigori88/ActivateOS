"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-700 text-[11px] font-bold text-white">
        P
      </span>
      <span className="text-sm font-semibold tracking-tight">
        Pursuit<span className="text-blue-700 dark:text-blue-400">OS</span>
      </span>
    </Link>
  );
}

/** Public marketing surfaces render without the app chrome. */
const CHROMELESS = ["/landing"];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (CHROMELESS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <>{children}</>;
  }

  const link = (item: NavItem, compact = false) => {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={
          compact
            ? `flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${
                active
                  ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-300"
              }`
            : `group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                active
                  ? "bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-100"
              }`
        }
      >
        <span className={compact ? "hidden" : active ? "text-blue-700 dark:text-blue-400" : "text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300"}>
          {item.icon}
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-52 flex-col border-r border-neutral-200 bg-white md:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div className="px-4 py-4">
          <Wordmark />
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4 scroll-thin">
          {NAV.map((group, i) => (
            <div key={i}>
              {group.label && (
                <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">{group.items.map((item) => link(item))}</div>
            </div>
          ))}
        </nav>
        <div className="border-t border-neutral-100 px-4 py-3 text-[11px] text-neutral-400 dark:border-neutral-800">
          Design Partner Demo
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/95">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Wordmark />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 scroll-thin">
          {NAV.flatMap((g) => g.items).map((item) => link(item, true))}
        </nav>
      </div>

      <div className="md:pl-52">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
