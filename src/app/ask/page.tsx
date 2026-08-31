import { withTenant } from "@/lib/db/tenant";
import { Card, PageHeader } from "@/components/ui";
import { askAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ask — the conversational surface over the same interpretation + resolver stack ⌘K uses
 * (P2C-1 §10), normalized for an executive audience (TD SYNNEX pre-demo §2/§3).
 *
 * SIMPLE BY DEFAULT, COMPLETE ON DEMAND — the same doctrine Today, Motions and Pipeline follow.
 *
 * The default reading order is commercial, not technical:
 *
 *     the ANSWER              one line, composed from the resolver's read-back
 *     what is AT STAKE        a canonical figure with its basis — or nothing at all
 *     SUPPORTING RECORDS      the canonical rows the answer stands on
 *     the NEXT USEFUL ACTION  one deep link into the room that changes it
 *
 * Everything an engineer needs — intent key, validated slots, resolution path, deep-link ids,
 * latency, catalog fingerprint, discarded interpretations — is preserved in full and moved one
 * click away, behind "Why this answer". Nothing was deleted; it stopped being the first thing an
 * executive reads.
 *
 * TWO THINGS THAT MUST NOT BE SOFTENED, and are not:
 *
 *  · UNCERTAINTY IS NOT HIDDEN. UNKNOWN, AMBIGUOUS and UNSUPPORTED render as prominently as a
 *    successful answer, with their meaning spelled out in words rather than left as a status word
 *    an executive has to decode. Progressive disclosure applies to provenance, never to doubt.
 *  · AN ABSENT FIGURE STAYS ABSENT. Where a resolver has no honest commercial figure, the "at
 *    stake" block is not rendered at all. No placeholder, no zero, no estimate.
 *
 * The latest answer is the hero; earlier questions collapse to one-line history entries that expand
 * in place with the identical layout. This is a decision surface, not a chat transcript.
 */

interface Exchange {
  id: string;
  question: string;
  answer: string;
  created_at: Date;
  intent_key: string | null;
  intent_class: string | null;
  resolution_path: string | null;
  outcome: string | null;
  slots: Record<string, unknown> | null;
  record_hrefs: string[] | null;
  scope_size: number | null;
  interpret_ms: number | null;
  resolve_ms: number | null;
  total_ms: number | null;
  rejection: string | null;
  catalog_version: string | null;
  significance: { label: string; value: string; basis: string } | null;
  next_action: { label: string; href: string } | null;
  unapplied: string[] | null;
}

const SUGGESTIONS = [
  "What should I focus on today?",
  "What renews in the next 90 days?",
  "Which high-value pursuits lack an economic buyer?",
  "Which value cases contain conflicting economic facts?",
  "Where is revenue blocked?",
  "What materially changed in the last 30 days?",
];

/** Outcome is part of the answer, so it is stated in words rather than only coloured. */
const OUTCOME: Record<string, { label: string; meaning: string; tone: string }> = {
  MATCHED: {
    label: "Answered",
    meaning: "The record holds this answer.",
    tone: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  UNKNOWN: {
    label: "Unknown",
    meaning: "The question was understood. The record does not hold the answer — this is not a zero.",
    tone: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  },
  AMBIGUOUS: {
    label: "Needs one more word",
    meaning: "The question admits more than one reading, so none was chosen.",
    tone: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300",
  },
  UNSUPPORTED: {
    label: "Not supported yet",
    meaning: "No registered capability covers this question.",
    tone: "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400",
  },
};

const PATH_WORD: Record<string, string> = {
  DETERMINISTIC: "parsed deterministically — no model was consulted",
  INTERPRETED: "interpreted by the model, resolved canonically",
  GOTO: "direct navigation — no model was consulted",
};

/** Slots the deterministic parser keeps for itself. Retained in the audit row; never displayed. */
const INTERNAL_SLOTS = new Set(["q", "interpreted"]);

/** A deep link, labelled by what it points at rather than by its uuid. */
function linkLabel(href: string): string {
  const [path, frag] = href.split("#");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return href;
  const kind = parts[0].replace(/s$/, "");
  const id = parts[1];
  return `${kind}${id ? ` ${id.slice(0, 6)}` : ""}${frag ? ` · ${frag}` : ""}`;
}

function Meta({ ex }: { ex: Exchange }) {
  const slots = ex.slots && typeof ex.slots === "object"
    ? Object.entries(ex.slots).filter(([k, v]) => v != null && !INTERNAL_SLOTS.has(k))
    : [];
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 py-1">
      <span className="w-40 shrink-0 text-label text-neutral-400">{label}</span>
      <span className="min-w-0 flex-1 text-xs text-neutral-600 dark:text-neutral-400">{value}</span>
    </div>
  );
  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      {ex.intent_key && row("Intent", <code className="font-mono">{ex.intent_key}</code>)}
      {ex.resolution_path && row("Resolved by", PATH_WORD[ex.resolution_path] ?? ex.resolution_path)}
      {slots.length > 0 && row("Understood as",
        <span className="flex flex-wrap gap-1">
          {slots.map(([k, v]) => (
            <code key={k} className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-label dark:bg-neutral-800">
              {k}: {String(v)}
            </code>
          ))}
        </span>)}
      {ex.scope_size != null && row("Scope", `${ex.scope_size} account(s) in the active ecosystem scope`)}
      {ex.record_hrefs && ex.record_hrefs.length > 0 && row("Records read",
        <span className="flex flex-wrap gap-1">
          {ex.record_hrefs.map((h, i) => (
            <a key={`${h}-${i}`} href={h} title={h}
               className="rounded border border-neutral-200 px-1.5 py-0.5 font-mono text-label text-accent hover:border-accent dark:border-neutral-800">
              {linkLabel(h)}
            </a>
          ))}
        </span>)}
      {row("Latency", `${ex.interpret_ms != null ? `interpret ${ex.interpret_ms}ms · ` : ""}resolve ${ex.resolve_ms ?? "—"}ms${ex.total_ms != null ? ` · total ${ex.total_ms}ms` : ""}`)}
      {/* Shown, not swallowed: a discarded model interpretation is exactly what an engineer needs. */}
      {ex.rejection && row("Interpretation discarded", <span className="text-amber-600 dark:text-amber-400">{ex.rejection}</span>)}
      {ex.catalog_version && row("Intent catalog", <code className="font-mono">{ex.catalog_version}</code>)}
      {row("Asked", `${new Date(ex.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC`)}
    </div>
  );
}

/** The full answer layout. Used for the hero and, identically, for an expanded history entry. */
function AnswerBody({ ex, hero }: { ex: Exchange; hero: boolean }) {
  const o = OUTCOME[ex.outcome ?? "MATCHED"] ?? OUTCOME.MATCHED;
  return (
    <>
      <p className={hero
        ? "text-base leading-relaxed text-neutral-800 dark:text-neutral-100"
        : "text-sm leading-relaxed text-neutral-700 dark:text-neutral-300"}>
        {ex.answer}
      </p>

      {/* Commercial significance — rendered ONLY when the resolver computed one. */}
      {ex.significance && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-label text-neutral-400">{ex.significance.label}</span>
          <span className="pos-metric-fig font-mono">{ex.significance.value}</span>
          <span className="w-full text-xs text-neutral-500">{ex.significance.basis}</span>
        </div>
      )}

      {/* What the answer did NOT apply. Sits ABOVE the outcome and above any disclosure, because
          an answer that ignored a clause is narrower than the question and the reader has to know
          that before they read the figure. */}
      {ex.unapplied && ex.unapplied.length > 0 && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
          This answer does not apply {ex.unapplied.join(" or ")}. PursuitOS cannot represent
          {ex.unapplied.length === 1 ? " that constraint" : " those constraints"} in one query yet, so
          {ex.unapplied.length === 1 ? " it was" : " they were"} left out rather than silently assumed.
        </p>
      )}

      {/* The outcome's meaning, in words. Never softened, never behind a click. */}
      {ex.outcome && ex.outcome !== "MATCHED" && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${o.tone}`}>{o.meaning}</p>
      )}

      {ex.next_action && (
        <a href={ex.next_action.href}
           className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
          {ex.next_action.label}
          <span aria-hidden="true">→</span>
        </a>
      )}

      <details className="group mt-4">
        <summary className="cursor-pointer list-none text-xs text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-300">
          Why this answer
          <span className="ml-1 text-neutral-400 group-open:hidden">▸</span>
          <span className="ml-1 hidden text-neutral-400 group-open:inline">▾</span>
        </summary>
        <Meta ex={ex} />
      </details>
    </>
  );
}

export default async function AskPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { exchanges } = await withTenant(async (db, orgId) => ({
    exchanges: (await db.query<Exchange>(
      `select id, question, answer, created_at, intent_key, intent_class, resolution_path,
              outcome, slots, record_hrefs, scope_size, interpret_ms, resolve_ms, total_ms,
              rejection, catalog_version, significance, next_action, unapplied
         from ask_exchanges where org_id = $1 order by created_at desc limit 25`,
      [orgId],
    )).rows,
  }));

  const [latest, ...history] = exchanges;

  return (
    <main>
      <PageHeader
        title="Ask"
        subtitle="The question is interpreted; the answer is retrieved from the record — never written."
      />

      {sp.notice && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {sp.notice}
        </div>
      )}

      <Card className="mb-6">
        <form action={askAction} className="flex gap-2">
          <input
            name="question"
            required
            placeholder="Ask about pursuits, renewals, partners, stakeholders, value cases, what changed…"
            className="flex-1 rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-800"
          />
          <button className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white">Ask</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <form key={s} action={askAction}>
              <input type="hidden" name="question" value={s} />
              <button className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600">
                {s}
              </button>
            </form>
          ))}
        </div>
      </Card>

      {!latest ? (
        <Card>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">No questions asked yet.</p>
          <p className="mt-1 text-xs text-neutral-500">
            A model reads your question to choose an intent. It never sees a record and never writes an answer —
            every figure, date and name comes from the same canonical resolvers the rooms render.
          </p>
        </Card>
      ) : (
        <>
          {/* ── The hero: the latest answer, visually dominant ───────────────────────────── */}
          <Card className="mb-6 border-neutral-300 dark:border-neutral-700">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-label leading-4 ${(OUTCOME[latest.outcome ?? "MATCHED"] ?? OUTCOME.MATCHED).tone}`}>
                {(OUTCOME[latest.outcome ?? "MATCHED"] ?? OUTCOME.MATCHED).label}
              </span>
              <span className="text-label text-neutral-400">Latest</span>
            </div>
            <h2 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-50">{latest.question}</h2>
            <AnswerBody ex={latest} hero />
          </Card>

          {/* ── History: compact by default, the same layout when expanded ───────────────── */}
          {history.length > 0 && (
            <>
              <h3 className="mb-2 text-label text-neutral-400">Earlier questions ({history.length})</h3>
              <div className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                {history.map((ex) => {
                  const o = OUTCOME[ex.outcome ?? "MATCHED"] ?? OUTCOME.MATCHED;
                  return (
                    <details key={ex.id} className="group bg-white dark:bg-neutral-950">
                      <summary className="flex cursor-pointer list-none items-baseline gap-3 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                        <span className={`shrink-0 rounded-full border px-1.5 py-0 text-micro leading-4 ${o.tone}`}>{o.label}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200" title={ex.question}>
                          {ex.question}
                        </span>
                        {ex.significance && (
                          <span className="shrink-0 font-mono text-xs tabular-nums text-neutral-500">{ex.significance.value}</span>
                        )}
                        <span className="shrink-0 text-label text-neutral-400">
                          {new Date(ex.created_at).toISOString().slice(5, 10)}
                        </span>
                      </summary>
                      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
                        <AnswerBody ex={ex} hero={false} />
                      </div>
                    </details>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <p className="mt-6 text-xs text-neutral-400">
        A model reads your question to choose an intent. It never sees a record, and it never writes an answer —
        every figure, date and name comes from the same canonical resolvers the rooms render.
      </p>
    </main>
  );
}
