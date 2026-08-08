import Link from "next/link";
import type { ReactNode } from "react";

/** Shared primitives implementing the design tokens (docs/DESIGN.md §3). */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900 ${className}`}
    >
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
    </header>
  );
}

const BAND_STYLES: Record<string, string> = {
  very_high: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
  high: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  medium: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
};

export const BAND_LABELS: Record<string, string> = {
  very_high: "Very high",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function BandBadge({ band }: { band: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BAND_STYLES[band] ?? BAND_STYLES.low}`}
    >
      {BAND_LABELS[band] ?? band}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  approved: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300",
  active: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  completed: "bg-neutral-100 text-neutral-600 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-400",
  abandoned: "bg-neutral-100 text-neutral-500 ring-neutral-500/20 line-through dark:bg-neutral-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${STATUS_STYLES[status] ?? STATUS_STYLES.completed}`}
    >
      {status}
    </span>
  );
}

export function Score({ value }: { value: number }) {
  return <span className="tnum text-lg font-semibold">{value.toFixed(0)}</span>;
}

export function StatChip({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "attention";
}) {
  const body = (
    <div
      className={`rounded-lg border px-4 py-3 ${
        tone === "attention" && Number(value) > 0
          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="tnum text-2xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function EvidenceLine({
  claim,
  meta,
}: {
  claim: string;
  meta: string;
}) {
  return (
    <li className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
      {claim} <span className="text-xs text-neutral-400 dark:text-neutral-500">({meta})</span>
    </li>
  );
}

export const FEATURE_LABELS: Record<string, string> = {
  technology_fit: "Technology fit",
  trigger_events: "Trigger events",
  strategic_initiative: "Strategic initiative",
  momentum: "Momentum",
  partner_strength: "Partner strength",
  negative_signals: "Negative signals",
  already_installed: "Target already installed",
};
