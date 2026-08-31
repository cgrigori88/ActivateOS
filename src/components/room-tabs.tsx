"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Room-pair tabs (#78): rooms that merged in the rail (Today+Queue,
 * Campaigns+Scheduled, Sources+Provider health) stay separate ROUTES — the
 * URLs, filters and deep links all survive — and this row is the seam between
 * them. Placed directly under the PageHeader of every member of a pair.
 */
export function RoomTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="Room sections" className="-mt-3 mb-6 inline-flex items-center gap-1 rounded-full glass p-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t.href) ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 text-body font-bold transition-colors duration-[140ms] ${
            active(t.href)
              ? "bg-accent text-white shadow-[var(--shadow-float,0_4px_14px_rgba(0,0,0,0.18))]"
              : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
