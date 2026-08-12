"use client";

import { useRouter } from "next/navigation";

/**
 * Single dropdown that switches the Mapping room's view (matrix / overlap /
 * coverage / targets), replacing the row of toggle buttons. Navigating resets
 * view-specific params so each view starts from its own clean rules.
 */
export function ViewSelect({
  current,
  views,
}: {
  current: string;
  views: { key: string; label: string }[];
}) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-xs font-medium text-neutral-500">View</span>
      <select
        value={current}
        onChange={(e) => router.push(`/mapping?view=${e.target.value}`)}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm font-medium dark:border-neutral-700 dark:bg-neutral-900"
      >
        {views.map((v) => (
          <option key={v.key} value={v.key}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
