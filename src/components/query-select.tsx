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
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-label font-semibold text-neutral-500 dark:text-neutral-400">{label}</span>
      {/* Native select, styled to match the rest of the control set. A native
          control keeps the platform's own picker on mobile, which beats any
          custom menu we would write. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[34px] rounded-full border border-neutral-300/70 bg-white/70 px-3 pr-7 text-body font-medium backdrop-blur transition-colors duration-[140ms] hover:border-neutral-400 focus:border-accent focus:outline-none dark:border-white/15 dark:bg-white/[0.06] dark:hover:border-white/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
