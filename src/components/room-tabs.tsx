"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { segmentClass, segmentTrackClass } from "./segmented";

// Re-exported so existing client call sites keep one import path.
export { segmentClass, segmentTrackClass };

/**
 * The one segmented-control grammar (Wave 1 §6).
 *
 * The previous treatment filled the selected tab with bright brand blue, which
 * put it in direct competition with the primary button on the same screen —
 * two saturated blue rectangles, one a navigation state and one an action. A
 * reader cannot tell from colour alone which one does something.
 *
 * So the accent steps back: the track is a quiet inset, the selected segment is
 * a RAISED surface with high-contrast ink, and brand blue is kept for focus
 * and hover. Selection reads as elevation and contrast — the way a macOS
 * segmented control does — rather than as saturation.
 */

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
    <nav aria-label="Room sections" className={`-mt-3 mb-6 ${segmentTrackClass()}`}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t.href) ? "page" : undefined}
          className={segmentClass(active(t.href))}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The same control for in-page view switching that is not a route change —
 * Pipeline's Attention / Portfolio / All, the Motions views. Pages were
 * authoring these as rows of filled buttons, which made a view selector look
 * like a row of unrelated calls to action.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={segmentTrackClass()}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={segmentClass(value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
