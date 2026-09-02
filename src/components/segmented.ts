/**
 * The one segmented-control grammar (Wave 1 §6), as pure class strings.
 *
 * These live OUTSIDE `room-tabs.tsx` because that file is `"use client"` — and a
 * function that takes a boolean and returns a string has no business being
 * client-only. Pipeline's view switcher is a server component; importing the
 * helper from the client module made the build succeed and then threw at
 * request time ("Attempted to call segmentTrackClass() from the server"). Class
 * strings are shared; only the interactive components are client.
 *
 * The grammar itself: the previous treatment filled the selected tab with bright
 * brand blue, which put it in direct competition with the primary button on the
 * same screen — two saturated blue rectangles, one a navigation state and one an
 * action, indistinguishable by colour. So the accent steps back. The track is a
 * quiet inset, the selected segment is a RAISED surface with high-contrast ink,
 * and brand blue is kept for focus and hover. Selection reads as elevation and
 * contrast, the way a macOS segmented control does, rather than as saturation.
 */

const TRACK =
  "inline-flex items-center gap-0.5 rounded-full p-1 " +
  "bg-[var(--surface-inset)] ring-1 ring-inset ring-[var(--border-subtle)]";

const SEGMENT =
  "rounded-full px-3.5 py-1.5 text-body font-semibold transition-all duration-[var(--dur-react)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const SELECTED = "bg-[var(--surface-primary)] text-[var(--ink)] shadow-[var(--shadow-low)]";
const UNSELECTED = "text-[var(--ink-muted)] hover:text-[var(--ink)]";

export function segmentClass(selected: boolean): string {
  return `${SEGMENT} ${selected ? SELECTED : UNSELECTED}`;
}

export function segmentTrackClass(): string {
  return TRACK;
}
