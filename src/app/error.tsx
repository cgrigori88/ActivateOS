"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui";

/**
 * Route-level error boundary: any unhandled server/render error lands here
 * instead of the framework's unstyled crash page. Recovery-first: retry the
 * render, or step back to Today. The digest is shown small for bug reports.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-4 px-6">
      <p className="text-body font-semibold uppercase tracking-wide text-neutral-400">Something went wrong</p>
      <h1 className="text-section font-semibold">That didn&apos;t work — nothing was lost.</h1>
      <p className="text-copy text-neutral-500">
        The action hit an unexpected error and was rolled back. You can retry it, or head back to Today and
        carry on — your data is unaffected.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className={buttonClass("primary", "md")}
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-control px-4 py-1.5 text-copy font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900"
        >
          Back to Today
        </Link>
      </div>
      {error.digest && (
        <p className="text-label text-neutral-400">
          Error reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
