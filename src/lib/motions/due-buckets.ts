/**
 * Due buckets for queued work — the ONE definition of "overdue", "due today" and "due this
 * week". The Queue groups its worklist by it, and Today's pursuit attention (vNext Slice 2B)
 * reads it to decide whether an approved action is overdue or due. Two surfaces, one clock
 * rule: an action can never be "overdue" in one room and "this week" in the other.
 *
 * Boundaries are the server's local calendar day, exactly as the Queue has always drawn them.
 */

export const DAY_MS = 86_400_000;

export type DueBucket = "OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | "NO_DATE";

/** Local midnight of `now`, in epoch milliseconds. */
export function startOfToday(now: Date = new Date()): number {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dueBucket(dueAt: Date | null, today0: number): DueBucket {
  if (!dueAt) return "NO_DATE";
  const t = dueAt.getTime();
  if (t < today0) return "OVERDUE";
  if (t < today0 + DAY_MS) return "TODAY";
  if (t < today0 + 7 * DAY_MS) return "THIS_WEEK";
  return "LATER";
}

/** The Queue's group headings, in the words it has always used. */
export const QUEUE_BUCKET_LABEL: Record<DueBucket, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  THIS_WEEK: "This week",
  LATER: "Later",
  NO_DATE: "No date",
};
