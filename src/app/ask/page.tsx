import { withTenant } from "@/lib/db/tenant";
import { Card, PageHeader } from "@/components/ui";
import { askAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ask — the conversational surface over the SAME interpretation + resolver stack ⌘K uses
 * (P2C-1 §10). Deliberately not a chatbot: an answer here is one canonical line, the records it
 * stands on, the scope it ran under, and the intent that produced it. There is no assistant turn,
 * because no model writes any of it.
 *
 * The row of metadata under each answer is the point of the surface as much as the answer is: an
 * operator can see which intent was chosen, whether the deterministic parser or the interpreter
 * chose it, and which records the answer stands on — so a wrong answer is diagnosable instead of
 * merely disappointing.
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
}

const SUGGESTIONS = [
  "What should I focus on today?",
  "What renews in the next 90 days?",
  "Which pursuits lack an economic buyer?",
  "What would strengthen Umbrella's value case?",
  "Why is Globex routed through WWT?",
  "What changed on Globex this week?",
];

const OUTCOME_STYLE: Record<string, string> = {
  MATCHED: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  UNKNOWN: "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
  AMBIGUOUS: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400",
  UNSUPPORTED: "border-neutral-300 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400",
};

const OUTCOME_MEANING: Record<string, string> = {
  MATCHED: "the record answered",
  UNKNOWN: "understood, but the record holds no answer",
  AMBIGUOUS: "needs one more word from you",
  UNSUPPORTED: "not something PursuitOS can answer yet",
};

/**
 * Slots that exist for the deterministic parser's own bookkeeping. They are kept in the audit
 * record (that is what the resolver actually ran on) but shown to nobody: rendering `q: <the whole
 * question>` as a "slot" beside the question itself is noise pretending to be provenance.
 */
const INTERNAL_SLOTS = new Set(["q", "interpreted"]);

/** A deep link, labelled by what it points at rather than by its full uuid. */
function linkLabel(href: string): string {
  const [path, frag] = href.split("#");
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return href;
  const kind = parts[0].replace(/s$/, "");
  const id = parts[1];
  const short = id && id.length > 8 ? id.slice(0, 6) : id;
  return `${kind}${short ? ` ${short}` : ""}${frag ? ` · ${frag}` : ""}`;
}

function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] leading-4 ${className || "border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"}`}>
      {children}
    </span>
  );
}

export default async function AskPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { exchanges } = await withTenant(async (db, orgId) => ({
    exchanges: (await db.query<Exchange>(
      `select id, question, answer, created_at, intent_key, intent_class, resolution_path,
              outcome, slots, record_hrefs, scope_size, interpret_ms, resolve_ms
         from ask_exchanges where org_id = $1 order by created_at desc limit 12`,
      [orgId],
    )).rows,
  }));

  return (
    <main>
      <PageHeader
        title="Ask"
        subtitle="Questions resolved against the verified record. The question is interpreted; the answer is retrieved — never written."
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
        <p className="mt-3 text-xs text-neutral-400">
          A model reads your question to choose an intent. It never sees a record, and it never writes an answer —
          every figure, date and name below comes from the same canonical resolvers the rooms render.
        </p>
      </Card>

      {exchanges.length === 0 ? (
        <p className="text-sm text-neutral-500">No questions asked yet.</p>
      ) : (
        <div className="space-y-4">
          {exchanges.map((ex) => {
            const hrefs = Array.isArray(ex.record_hrefs) ? ex.record_hrefs : [];
            const slots = ex.slots && typeof ex.slots === "object"
              ? Object.entries(ex.slots).filter(([k, v]) => v != null && !INTERNAL_SLOTS.has(k))
              : [];
            return (
              <Card key={ex.id}>
                <p className="mb-1 text-sm font-semibold">{ex.question}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{ex.answer}</p>

                {(ex.outcome || ex.intent_key) && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {ex.outcome && (
                      <Chip className={OUTCOME_STYLE[ex.outcome] ?? ""}>
                        {ex.outcome} · {OUTCOME_MEANING[ex.outcome] ?? ""}
                      </Chip>
                    )}
                    {ex.intent_key && <Chip>intent {ex.intent_key}</Chip>}
                    {ex.resolution_path && (
                      <Chip>
                        {ex.resolution_path === "INTERPRETED" ? "interpreted by model, resolved canonically"
                          : ex.resolution_path === "DETERMINISTIC" ? "parsed deterministically — no model"
                          : "direct navigation — no model"}
                      </Chip>
                    )}
                    {slots.map(([k, v]) => <Chip key={k}>{k}: {String(v)}</Chip>)}
                    {ex.scope_size != null && <Chip>scope: {ex.scope_size} account(s)</Chip>}
                  </div>
                )}

                {hrefs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {hrefs.slice(0, 8).map((h, i) => (
                      <a
                        key={`${h}-${i}`}
                        href={h}
                        title={h}
                        className="rounded border border-neutral-200 px-2 py-0.5 font-mono text-[11px] leading-4 text-accent hover:border-accent dark:border-neutral-800"
                      >
                        {linkLabel(h)}
                      </a>
                    ))}
                    {hrefs.length > 8 && <span className="text-xs text-neutral-400">+{hrefs.length - 8} more</span>}
                  </div>
                )}

                <p className="mt-2 text-label text-neutral-400">
                  {new Date(ex.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                  {ex.interpret_ms != null && <> · interpreted in {ex.interpret_ms}ms</>}
                  {ex.resolve_ms != null && <> · resolved in {ex.resolve_ms}ms</>}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
