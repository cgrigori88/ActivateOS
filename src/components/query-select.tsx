"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Generic filter/group control (shared kit). Sets one query param on the
 * current path, preserving the others, and navigates. "all" clears the param.
 * Reused across Motions / Campaigns / Pipeline / Analytics / etc.
 */
export function QuerySelect({
  param,
  value,
  label,
  options,
}: {
  param: string;
  value: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const onChange = (v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v && v !== "all") p.set(param, v);
    else p.delete(param);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
