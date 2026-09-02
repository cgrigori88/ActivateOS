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
    <label className="inline-flex items-center gap-2 text-copy">
      <span className="text-body font-medium text-neutral-500">View</span>
      <select
        value={current}
        onChange={(e) => router.push(`/mapping?view=${e.target.value}`)}
        className="rounded-control border border-neutral-300 bg-white px-2.5 py-1.5 text-copy font-medium dark:border-neutral-700 dark:bg-neutral-900"
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

/**
 * Partner picker for the matrix — a dropdown (scales past a handful of partners
 * where buttons would get messy). Includes an "All partners" consolidated view.
 * Switching resets the organize (row/col) selection.
 */
export function PartnerSelect({
  current,
  hideEmpty,
  partners,
}: {
  current: string;
  hideEmpty?: boolean;
  partners: { id: string; name: string }[];
}) {
  const router = useRouter();
  const go = (value: string) =>
    router.push(`/mapping?view=matrix&partner=${value}${hideEmpty ? "&hide=1" : ""}`);
  return (
    <label className="inline-flex items-center gap-2 text-copy">
      <span className="text-body font-medium text-neutral-500">Partner</span>
      <select
        value={current}
        onChange={(e) => go(e.target.value)}
        className="rounded-control border border-neutral-300 bg-white px-2.5 py-1.5 text-copy font-medium dark:border-neutral-700 dark:bg-neutral-900"
      >
        <option value="all">All partners</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}
