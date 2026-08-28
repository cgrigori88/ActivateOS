import { withTenant } from "@/lib/db/tenant";
import { Card, PageHeader } from "@/components/ui";
import { askAction } from "./actions";

export const dynamic = "force-dynamic";
// A grounded answer can take several tool rounds — keep the serverless limit up.
export const maxDuration = 60;

/**
 * Ask (slice A of the meets/beats/leaps batch): the conversational surface
 * over the org's own MCP tools. The same governed reads a BYO-bot gets,
 * without leaving the product — and every exchange lands on the record.
 */

interface Exchange {
  id: string;
  question: string;
  answer: string;
  tool_calls: { tool: string; args: Record<string, unknown> }[];
  created_at: Date;
}

const SUGGESTIONS = [
  "Which deals are at risk right now, and why?",
  "What do we know about Umbrella Health Systems?",
  "Does our CRM tie out with the live pipeline?",
  "Where are we against the Meridian initiative?",
];

export default async function AskPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const sp = await searchParams;
  const { exchanges } = await withTenant(async (db, orgId) => ({
    exchanges: (await db.query<Exchange>(
      `select id, question, answer, tool_calls, created_at
       from ask_exchanges where org_id = $1 order by created_at desc limit 12`,
      [orgId],
    )).rows,
  }));

  return (
    <main>
      <PageHeader
        title="Ask"
        subtitle="Questions answered from the verified record — the same governed tools any AI you bring gets, without leaving the room."
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
            placeholder="Ask about accounts, deals, partners, initiatives, the tie-out…"
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
          Answers come only from tool reads over this tenant&apos;s record — if the record doesn&apos;t hold it, the answer says so.
          Every exchange is kept below, auditable like everything else.
        </p>
      </Card>

      {exchanges.length === 0 ? (
        <p className="text-sm text-neutral-500">No questions asked yet.</p>
      ) : (
        <div className="space-y-4">
          {exchanges.map((ex) => (
            <Card key={ex.id}>
              <p className="mb-1 text-sm font-semibold">{ex.question}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{ex.answer}</p>
              <p className="mt-2 text-label text-neutral-400">
                {new Date(ex.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                {ex.tool_calls.length > 0 && (
                  <> · grounded by {ex.tool_calls.map((c) => c.tool).join(", ")}</>
                )}
              </p>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
