"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CommandPalette } from "@/components/command-palette";
import { ScopeSelector } from "@/components/scope/scope-selector";
import { ScopeChip } from "@/components/scope/scope-chip";
import type { ScopeContext, ScopeOption } from "@/lib/scope/scope";
import { buttonClass } from "@/components/ui";

/**
 * Application shell: grouped left sidebar on desktop, horizontal nav on
 * mobile — the decision-cockpit IA from BLUEPRINT §56, scoped to the
 * surfaces that exist today.
 */

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Extra routes that light this item up — rooms living as tabs under it. */
  also?: string[];
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
  contacts: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3.5 13c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5" />
    </svg>
  ),
  campaigns: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <path d="M2 4l6 4 6-4M2 4h12v8H2z" />
    </svg>
  ),
  upcoming: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  ),
};

/* The rail follows the loop (#78, PLATFORM-REVIEW-2 §III.B): Decide → Build →
   Partner → Measure → Platform. Queue, Scheduled sends and Provider health
   live as TABS inside Today, Campaigns and Intelligence — their routes
   survive, `also` keeps the rail item lit while you're on them. */
const PARTNERS_ICON = (
  <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
    <circle cx="5.5" cy="8" r="3.8" />
    <circle cx="10.5" cy="8" r="3.8" />
  </svg>
);
const SKILLS_ICON = (
  <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
    <path d="M8 1.8l1.5 3.6 3.9.4-2.9 2.6.8 3.8L8 10.3l-3.3 1.9.8-3.8-2.9-2.6 3.9-.4z" />
  </svg>
);
/* Pursuits — a crosshair on a target: the canonical commercial object, first
   class in Intelligence (D.5 §2/§21). */
const PURSUITS_ICON = (
  <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="1.8" />
    <path d="M8 0.6v2.2M8 13.2v2.2M0.6 8h2.2M13.2 8h2.2" />
  </svg>
);

/* The rail tells the product story (D.5 §2/§21): PursuitOS as an operating
   system, not a page list — Ecosystem (who can create value together) →
   Intelligence (where to pursue revenue and why) → Execution (what happens
   next) → Revenue (what it created). Pursuits is the first-class Intelligence
   object. Category labels stay understated; the hierarchy carries the meaning. */
const NAV: NavGroup[] = [
  { label: null, items: [
    { href: "/", label: "Today", icon: icons.today },
  ] },
  {
    label: "Ecosystem",
    items: [
      { href: "/intake", label: "Intake", icon: icons.intake },
      { href: "/mapping", label: "Mapping", icon: icons.mapping },
      { href: "/contacts", label: "Contacts", icon: icons.contacts },
      { href: "/partners", label: "Partners", also: ["/joint"], icon: PARTNERS_ICON },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: icons.campaigns },
      { href: "/upcoming", label: "Upcoming", icon: icons.upcoming },
      { href: "/analytics", label: "Analytics", icon: icons.providerHealth },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/pursuits", label: "Pursuits", icon: PURSUITS_ICON },
      { href: "/accounts", label: "Accounts", icon: icons.accounts },
      { href: "/sources", label: "Sources", icon: icons.sources },
      { href: "/provider-health", label: "Provider health", icon: icons.providerHealth },
      { href: "/review", label: "Review", icon: icons.review },
      { href: "/trust", label: "Trust", icon: icons.review },
    ],
  },
  {
    label: "Execution",
    items: [
      { href: "/motions", label: "Motions", icon: icons.motions, also: ["/briefs"] },
      { href: "/queue", label: "Queue", icon: icons.queue },
    ],
  },
  {
    label: "Revenue",
    items: [
      { href: "/goals", label: "Goals", icon: icons.today },
      { href: "/pipeline", label: "Pipeline", icon: icons.pipeline },
      { href: "/insights", label: "Insights", icon: icons.insights },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/ask", label: "Ask", icon: icons.insights },
      { href: "/skills", label: "Skills", icon: SKILLS_ICON },
    ],
  },
];

/* Owners see these appended to the Platform group. */
const ADMIN_ITEMS: NavItem[] = [
  {
    href: "/routines",
    label: "Routines",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
        <circle cx="8" cy="8" r="6.2" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
    ),
  },
  {
    href: "/admin",
    label: "Admin",
    icon: (
      <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" />
      </svg>
    ),
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The PursuitOS mark: a circle carrying two voids on one axis. Fixed bearing,
 * one colour, no stroked variant. Inherits currentColor.
 */
const MARK = (
  <svg viewBox="0 0 48 48" className="h-[22px] w-[22px]" fill="currentColor" fillRule="nonzero" aria-hidden focusable="false">
    <path d="M4 24 A20 20 0 1 1 44 24 A20 20 0 1 1 4 24 Z M29 26 A10 10 0 1 0 9 26 A10 10 0 1 0 29 26 Z M39 17 A4 4 0 1 0 31 17 A4 4 0 1 0 39 17 Z" />
  </svg>
);

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="text-accent dark:text-blue-400">{MARK}</span>
      <span className="text-title font-bold tracking-[-0.03em]">PursuitOS</span>
    </Link>
  );
}

const RAIL_KEY = "pursuitos:rail-collapsed";
const THEME_KEY = "pursuitos:theme";

export function Shell({
  children,
  user,
  signOut,
  isOwner,
  badges,
  alerts,
  guest,
  pursuitExperience,
  scopeOptions,
  scopeActive,
}: {
  children: ReactNode;
  /** Signed-in identity email; null in Basic-Auth / local-dev mode. */
  user?: string | null;
  signOut?: () => Promise<void>;
  /** Owners see the Platform/Admin group. */
  isOwner?: boolean;
  /** Attention counts by nav href — e.g. { "/mapping": 2 } renders an amber pill on that item. */
  badges?: Record<string, number>;
  /** FAILURE counts by nav href — red pill (something broke), never "waiting on you" blue. */
  alerts?: Record<string, number>;
  /** Guest workspace (B+2): free seat riding a partnership; Admin explains the cap. */
  guest?: boolean;
  /** Workstream D: PURSUIT_EXPERIENCE_ENABLED — adds the Pursuits room when on (default off). */
  pursuitExperience?: boolean;
  /** Ecosystem scope options derived from the tenant's data (scale-disclosure §1). */
  scopeOptions?: ScopeOption[];
  /** The active resolved scope (label + facts) for the selector + chip. */
  scopeActive?: ScopeContext;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dark, setDark] = useState(false);
  const [palette, setPalette] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  /* The rail only sometimes overflows — 16 destinations fit on a tall window
     and not on a short one. A permanent scrollbar for an occasional overflow is
     chrome that earns nothing, so the bar is hidden and a fade marks the edge
     only when there is actually more to reach. */
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const sync = () => {
      const more = el.scrollHeight - el.clientHeight - el.scrollTop > 4;
      el.classList.toggle("is-overflowing", more);
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [collapsed]);

  // Auth surfaces stand alone: no rail, no chrome — you aren't "inside" yet.
  // /join is the public guest-seat landing (B+2), same posture.
  //
  // Matched on whole path SEGMENTS, not string prefixes. `"/joint".startsWith("/join")`
  // is true, so a prefix test silently stripped the entire navigation off the
  // Joint pursuits room — a signed-in co-sell surface rendered as though the
  // viewer were not signed in. Found on the live demo, where /joint came up
  // full-bleed with no rail.
  const bareRoots = ["/login", "/join"];
  const bare = bareRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));

  // Owners get Routines + Admin folded into the Platform group (never a
  // separate group — Intelligence belongs to everyone, governance to owners).
  const baseNav =
    isOwner === false
      ? NAV
      : NAV.map((g, i) => (i === NAV.length - 1 ? { ...g, items: [...g.items, ...ADMIN_ITEMS] } : g));
  // Workstream D/D.5: Pursuits is a first-class Intelligence room, gated by its
  // flag — present in the taxonomy, filtered out of Intelligence when off.
  const navGroups = pursuitExperience
    ? baseNav
    : baseNav.map((g) => (g.label === "Intelligence" ? { ...g, items: g.items.filter((it) => it.href !== "/pursuits") } : g));

  /* Light is the default: the app opens light regardless of the OS setting, and
     only a stored choice turns it dark. */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY) === "dark";
      setDark(stored);
      document.documentElement.classList.toggle("dark", stored);
    } catch {
      /* storage unavailable — light is the right default anyway */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      try {
        window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  // Restore the width the operator left the rail at.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* storage unavailable — the default width is fine */
    }
  }, []);

  const toggleRail = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  // "[" toggles the rail from anywhere that is not a text field; ⌘K / Ctrl-K
  // opens the palette from ANYWHERE, text fields included — that is the point.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
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

  useEffect(() => {
    setDrawer(false);
    setPalette(false);
  }, [pathname]);

  const link = (item: NavItem) => {
    const active =
      isActive(pathname, item.href) || (item.also ?? []).some((h) => isActive(pathname, h));
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex min-h-[34px] items-center gap-3 rounded-full px-3 py-[6px] text-body transition-colors duration-[140ms] ${
          active
            ? "bg-white/[0.14] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            : "font-medium text-rail-ink-soft hover:bg-white/[0.07] hover:text-rail-ink"
        }`}
      >
        <span className={active ? "shrink-0 text-accent-tint" : "shrink-0 text-rail-ink-soft/70 transition-colors duration-[140ms] group-hover:text-rail-ink"}>
          {item.icon}
        </span>
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
        {(alerts?.[item.href] ?? 0) > 0 && !collapsed && (
          <span
            className="ml-auto rounded-full bg-red-600 px-1.5 py-0.5 text-micro font-bold leading-none text-white shadow-[0_0_0_1px_rgba(255,255,255,0.14)]"
            title={`${alerts![item.href]} failure(s) — something broke`}
          >
            {alerts![item.href]}
          </span>
        )}
        {(alerts?.[item.href] ?? 0) > 0 && collapsed && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" title={`${alerts![item.href]} failure(s)`} />
        )}
        {(badges?.[item.href] ?? 0) > 0 && !(alerts?.[item.href] ?? 0) && !collapsed && (
          <span
            className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-micro font-bold leading-none text-white shadow-[0_0_0_1px_rgba(255,255,255,0.14)]"
            title={`${badges![item.href]} item(s) need review`}
          >
            {badges![item.href]}
          </span>
        )}
        {(badges?.[item.href] ?? 0) > 0 && !(alerts?.[item.href] ?? 0) && collapsed && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-tint" title={`${badges![item.href]} item(s) need review`} />
        )}
        {active && !collapsed && !(badges?.[item.href] ?? 0) && !(alerts?.[item.href] ?? 0) && (
          <span className="absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent-tint" />
        )}
      </Link>
    );
  };

  const themeButton = (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-rail-ink-soft transition-colors duration-[140ms] hover:bg-white/10 hover:text-rail-ink"
    >
      {dark ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
          <circle cx="8" cy="8" r="3.2" />
          <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
          <path d="M13.5 9.6A5.8 5.8 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1z" />
        </svg>
      )}
    </button>
  );

  /* The rail is dark in both themes — it is a material, not a mode, and the
     contrast against a light room is most of what carries the layout. */
  const railBody = (
    <>
      <div className={`flex min-h-[52px] items-center px-4 py-3 ${collapsed ? "justify-center" : ""}`}>
        <Link href="/" aria-label="PursuitOS home" className="flex items-center gap-2 text-rail-ink">
          <span className="text-accent-tint">{MARK}</span>
          {!collapsed && <span className="text-title font-bold tracking-[-0.03em]">PursuitOS</span>}
        </Link>
        {guest && !collapsed && (
          <Link
            href="/admin"
            title="Guest workspace — a free seat riding your partnership. Admin explains what's included."
            className="ml-auto rounded-full bg-amber/20 px-2 py-0.5 text-micro font-bold uppercase tracking-[0.1em] text-amber-300 hover:bg-amber/30"
          >
            Guest
          </Link>
        )}
      </div>
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => setPalette(true)}
          title="Search  ⌘K"
          className={`flex w-full min-h-[34px] items-center gap-3 rounded-full px-3 py-[6px] text-body font-medium text-rail-ink-soft transition-colors duration-[140ms] hover:bg-white/[0.07] hover:text-rail-ink ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" {...stroke}>
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          {!collapsed && <span className="truncate">Search</span>}
          {!collapsed && (
            <kbd className="ml-auto rounded-control border border-white/15 px-1.5 py-0.5 font-mono text-micro leading-none text-rail-ink-soft/80">
              ⌘K
            </kbd>
          )}
        </button>
        {scopeOptions && scopeActive && (
          <div className="mt-0.5">
            <ScopeSelector options={scopeOptions} active={scopeActive.scope} collapsed={collapsed} />
          </div>
        )}
      </div>
      <nav ref={navRef} className="pos-rail-scroll flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {navGroups.map((group, i) => (
          <div key={i}>
            {group.label && !collapsed && (
              <p className="mb-1 px-3 text-micro font-bold uppercase tracking-[0.12em] text-rail-ink-soft/60">
                {group.label}
              </p>
            )}
            {group.label && collapsed && <div className="mx-3 mb-2 h-px bg-white/[0.07]" />}
            <div className="space-y-0.5">{group.items.map((item) => link(item))}</div>
          </div>
        ))}
      </nav>
      <div className={`border-t border-white/[0.07] px-4 py-3 ${collapsed ? "text-center" : ""}`}>
        {collapsed ? (
          themeButton
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-label font-bold uppercase text-white">
              {user ? user.slice(0, 2) : "OP"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold text-rail-ink">{user ?? "Operator"}</span>
              {user && signOut ? (
                <form action={signOut}>
                  <button className={buttonClass("subtle", "md")}>Sign out</button>
                </form>
              ) : (
                <span className="block truncate text-label text-rail-ink-soft">demo access</span>
              )}
            </span>
            {themeButton}
          </div>
        )}
      </div>
    </>
  );

  if (bare) return <div className="min-h-screen px-4">{children}</div>;

  return (
    <div className="min-h-screen">
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {/* Chrome floats over content rather than butting against it. */}
      <aside
        className={`glass-rail fixed bottom-3 left-3 top-3 z-20 hidden flex-col overflow-hidden rounded-panel text-rail-ink transition-[width] duration-[220ms] md:flex ${
          collapsed ? "w-[68px]" : "w-[236px]"
        }`}
      >
        {railBody}
      </aside>

      {/* Mobile gets a drawer: 68px of icons fails the 44px touch target. */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-neutral-950/45 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
          />
          <aside className="glass-rail absolute bottom-3 left-3 top-3 flex w-[264px] flex-col overflow-hidden rounded-panel text-rail-ink">
            {railBody}
          </aside>
        </div>
      )}

      <div className={collapsed ? "md:pl-[92px]" : "md:pl-[260px]"}>
        <div className="glass sticky top-3 z-30 mx-3 mt-3 flex min-h-[52px] items-center gap-2 rounded-card px-3 md:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-600 transition-colors duration-[140ms] hover:bg-neutral-900/[0.06] dark:text-neutral-300 dark:hover:bg-white/10"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}><path d="M2 4h12M2 8h12M2 12h12" /></svg>
          </button>
          <Wordmark />
        </div>

        {/* Desktop's only global control floats: a full-width bar around one
            button reads as hollow. */}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
          className="glass fixed top-4 z-30 hidden h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-[left,color] duration-[220ms] hover:text-neutral-900 md:inline-flex dark:text-neutral-400 dark:hover:text-neutral-100"
          style={{ left: collapsed ? 104 : 272 }}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" {...stroke}>
            <rect x="2" y="3" width="12" height="10" rx="2" />
            <path d="M6.5 3v10" />
          </svg>
        </button>

        <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-4 sm:px-6 md:pt-16 lg:px-7">
          {scopeActive && <ScopeChip active={scopeActive} />}
          {children}
        </div>
      </div>
    </div>
  );
}
