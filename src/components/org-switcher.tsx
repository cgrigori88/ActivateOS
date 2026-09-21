"use client";

import { useTransition } from "react";

export interface OrgOption { orgId: string; name: string; role: string }

/**
 * THE ORGANIZATION SWITCHER.
 *
 * It renders ONLY the memberships the server resolved for the authenticated user, and with a single
 * membership it renders nothing at all — a chooser with one choice is noise, and `currentOrgId`
 * already falls back deterministically.
 *
 * THE ID IT SUBMITS IS NOT A TRUST BOUNDARY. The action re-checks membership before it will set
 * anything, and `currentOrgId` re-checks the cookie against `org_members` on every single read — so
 * an id typed into this control by hand buys nothing. What the list shows is a convenience; what
 * the server accepts is a membership.
 */
export function OrgSwitcher({ options, currentOrgId, onSwitch }: {
  options: OrgOption[];
  currentOrgId: string | null;
  onSwitch: (orgId: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  if (options.length < 2) return null;
  const current = options.find((o) => o.orgId === currentOrgId);
  return (
    <label className="block px-3 pb-2">
      <span className="mb-1 block text-label text-rail-ink-soft">
        Organization{current ? ` · ${current.role}` : ""}
      </span>
      <select
        aria-label="Switch organization"
        disabled={pending}
        value={currentOrgId ?? ""}
        onChange={(e) => start(() => { void onSwitch(e.target.value); })}
        className="w-full rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900"
      >
        {options.map((o) => (
          <option key={o.orgId} value={o.orgId}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}
