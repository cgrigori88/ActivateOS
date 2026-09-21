import { buttonClass } from "@/components/ui";
import type { MotionFit } from "@/lib/motions/eligibility";

/**
 * RECOMMENDED MOTIONS on a pursuit.
 *
 * ── THE CARD HAS TO SURVIVE BEING READ BY A SCEPTIC ─────────────────────────────────────────────
 *
 * It shows the commercial objective, WHY this account qualifies (the clauses that actually decided
 * it, in the words the template declared), and WHAT IS MISSING — the things this product cannot yet
 * observe, stated plainly rather than quietly omitted. A motion that fits for reasons the reader
 * cannot inspect is indistinguishable from a guess.
 *
 * ── THREE STATES GET THREE TREATMENTS ───────────────────────────────────────────────────────────
 *
 * ELIGIBLE offers the action. INSUFFICIENT_CONTEXT offers it too, but says what is unknown first:
 * "we cannot tell" is not a reason to stop a person who can. NOT_ELIGIBLE is shown WITHOUT the
 * action and says which clause decided — because the useful thing about a motion that does not fit
 * is knowing why, not having it hidden.
 *
 * Applying is always a form submission, never a link: a GET happens on prefetch and back, and
 * instantiating commercial structure is not something to do by accident.
 */
export function RecommendedMotions({ fits, pursuitId, apply }: {
  fits: MotionFit[];
  pursuitId: string;
  /** The server action. It returns a result for callers that want one; the form ignores it. */
  apply: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  if (fits.length === 0) return null;
  const order = { ELIGIBLE: 0, INSUFFICIENT_CONTEXT: 1, NOT_ELIGIBLE: 2 } as const;
  const sorted = [...fits].sort((a, b) => order[a.verdict] - order[b.verdict] || a.slug.localeCompare(b.slug));

  return (
    <ul className="space-y-3">
      {sorted.map((f) => {
        const decided = f.clauses.filter((c) => c.satisfied !== null);
        const unknown = f.clauses.filter((c) => c.satisfied === null);
        const blocking = f.clauses.find((c) => c.satisfied === false);
        return (
          <li key={f.slug} className="rounded-inner border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-copy font-semibold">{f.name}</span>
                <span className="mt-0.5 block text-label text-neutral-500">
                  {f.verdict === "ELIGIBLE" ? "Appears to fit"
                    : f.verdict === "INSUFFICIENT_CONTEXT" ? "May fit — some context is missing"
                      : "Does not fit"}
                </span>
              </span>
              {f.verdict === "NOT_ELIGIBLE" ? (
                <span className="flex-none text-label text-neutral-500">not offered</span>
              ) : (
                <form action={async (fd: FormData) => { "use server"; await apply(fd); }} className="flex-none">
                  <input type="hidden" name="slug" value={f.slug} />
                  <input type="hidden" name="pursuitId" value={pursuitId} />
                  <button className={buttonClass("primary", "md")}>Apply motion →</button>
                </form>
              )}
            </div>

            {blocking && (
              <p className="mt-2 text-label text-neutral-600 dark:text-neutral-300">
                <b className="ink-muted">Why not:</b> {blocking.because}
              </p>
            )}
            {decided.filter((c) => c.satisfied === true).length > 0 && (
              <p className="mt-2 text-label text-neutral-600 dark:text-neutral-300">
                <b className="ink-muted">Why it fits:</b>{" "}
                {decided.filter((c) => c.satisfied === true).map((c) => c.because).join("; ")}
              </p>
            )}
            {(unknown.length > 0 || f.missingContext.length > 0) && (
              /* Stated, not omitted. What we cannot see is part of the answer, and hiding it would
                 make a partially-informed recommendation look like a confident one. */
              <p className="mt-1.5 text-label text-neutral-500">
                <b className="ink-muted">Not yet known:</b>{" "}
                {[...unknown.map((c) => c.because), ...f.missingContext].join("; ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
