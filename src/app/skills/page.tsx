import Link from "next/link";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { Card, PageHeader } from "@/components/ui";
import { SKILL_KINDS, listSkills, type SkillKind } from "@/lib/skills/skills";
import { createSkillAction, setSkillStatusAction, updateSkillBodyAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Skills library (task #84): every reusable instruction the org's agents
 * follow, in one governed place — typed, scoped, and attributed. The uses
 * column comes from agent_runs.skill_ids: real grounding events, not clicks.
 */

const input =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";

const KIND_STYLE: Record<SkillKind, string> = {
  positioning: "bg-accent/12 text-accent dark:text-blue-300",
  process: "bg-emerald/12 text-emerald dark:text-emerald-300",
  style: "bg-amber/14 text-amber dark:text-amber-300",
  rules: "bg-rose/12 text-rose dark:text-rose-300",
};

export default async function SkillsPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const skills = await listSkills(pool, orgId);
  const active = skills.filter((s) => s.status === "active");
  const archived = skills.filter((s) => s.status === "archived");

  const { rows: partners } = await pool.query<{ id: string; name: string }>(
    `select id, name from partners where org_id = $1 order by name`,
    [orgId],
  );
  const { rows: lists } = await pool.query<{ id: string; name: string }>(
    `select id, name from account_populations where org_id = $1 and status = 'approved' order by name`,
    [orgId],
  );

  // The typed grounding that predates the library — surfaced here so the
  // library really is ONE place to see everything the agents follow.
  const { rows: alsoRows } = await pool.query<{ playbooks: string; joint: string; plays: string; brand: string }>(
    `select
       (select count(*) from partner_playbooks where org_id = $1)::text as playbooks,
       (select count(*) from joint_playbooks jp join partnerships p on p.id = jp.partnership_id
         where p.initiator_org_id = $1 or p.counterpart_org_id = $1)::text as joint,
       (select count(*) from play_templates where status = 'active')::text as plays,
       (select count(*) from brand_profiles where org_id = $1)::text as brand`,
    [orgId],
  );
  const also = alsoRows[0];

  const kindLabel = (k: SkillKind) => SKILL_KINDS.find((x) => x.kind === k)!;

  return (
    <main>
      <PageHeader
        title="Skills"
        subtitle="Reusable instructions your AI agents follow — typed, scoped, and attributed to the runs they grounded"
      />

      {sp.notice && (
        <Card className="mb-6">
          <p className="text-sm">{sp.notice}</p>
        </Card>
      )}

      {/* ── The library ── */}
      <Card className="mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Library</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Every skill declares what it is, where it applies, and which agents read it — and the uses count is
          real: it counts the AI runs each skill actually grounded.
        </p>
        {active.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No skills yet — add the first one below. Good first skills: how you position against the status quo,
            your deal-registration process, the phrases your team never puts in a customer email.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {active.map((s) => (
              <li key={s.id} className="py-2.5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${KIND_STYLE[s.kind]}`}>
                      {kindLabel(s.kind).label.toLowerCase()}
                    </span>
                    <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-500">
                      {s.scopeLabel}
                    </span>
                    <span className="ml-auto text-xs text-neutral-400">
                      Grounds: {kindLabel(s.kind).surfaces.join(" · ")}
                      {" · "}
                      <span className="tnum font-semibold text-neutral-600 dark:text-neutral-300">{s.uses}</span>{" "}
                      {s.uses === 1 ? "use" : "uses"}
                      {s.lastUsedAt ? ` · last ${s.lastUsedAt}` : ""}
                    </span>
                  </summary>
                  <div className="mt-2 pl-1">
                    <form action={updateSkillBodyAction.bind(null, s.id)}>
                      <textarea name="body" rows={4} maxLength={6000} defaultValue={s.body} className={`${input} w-full`} />
                      <div className="mt-1.5 flex items-center gap-3">
                        <button className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800">
                          Save changes
                        </button>
                        <span className="text-[11px] text-neutral-400">
                          {s.createdBy ? `by ${s.createdBy} · ` : ""}updated {s.updatedAt}
                        </span>
                      </div>
                    </form>
                    <form action={setSkillStatusAction.bind(null, s.id, "archived")} className="mt-1.5">
                      <button className="text-[11px] font-medium text-neutral-500 hover:underline">
                        Archive — agents stop reading it immediately
                      </button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <details className="mt-3 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <summary className="cursor-pointer text-xs font-medium text-neutral-500">
              {archived.length} archived
            </summary>
            <ul className="mt-1 space-y-1">
              {archived.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm text-neutral-500">
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="text-[11px]">{s.uses} uses</span>
                  <form action={setSkillStatusAction.bind(null, s.id, "active")}>
                    <button className="text-[11px] font-medium text-accent hover:underline">restore</button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {/* ── Add a skill ── */}
      <Card className="mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Add a skill</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Write it once; every drafting run on its surfaces follows it. Keep one skill per topic — if a{" "}
          {SKILL_KINDS[0].label.toLowerCase()} skill for the same scope already exists above, edit it instead.
        </p>
        <form action={createSkillAction} className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Name</span>
              <input name="name" required maxLength={120} placeholder="How we open enterprise deals" className={`${input} w-64`} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Kind</span>
              <select name="kind" className={input}>
                {SKILL_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-neutral-500">Applies to</span>
              <select name="scopeType" className={input}>
                <option value="org">Whole org</option>
                {partners.length > 0 && <option value="partner">One partner…</option>}
                {lists.length > 0 && <option value="list">One list…</option>}
              </select>
            </label>
            {partners.length > 0 && (
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Partner (if partner-scoped)</span>
                <select name="partnerId" className={input}>
                  <option value="">—</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            {lists.length > 0 && (
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">List (if list-scoped)</span>
                <select name="listId" className={input}>
                  <option value="">—</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="text-[11px] text-neutral-400">
            {SKILL_KINDS.map((k) => `${k.label}: ${k.hint}`).join(" ")}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-neutral-500">Instructions the agents will follow</span>
            <textarea
              name="body"
              rows={4}
              required
              maxLength={6000}
              placeholder="Lead with the compliance-automation story for regulated industries; name the platform team as the economic buyer; never promise implementation timelines in a first touch…"
              className={`${input} w-full`}
            />
          </label>
          <button className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-800">
            Add to the library
          </button>
        </form>
      </Card>

      {/* ── The rest of the org's standing grounding ── */}
      <Card muted>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Also grounding your agents
        </h2>
        <p className="mb-2 text-sm text-neutral-500">
          Typed grounding that lives in its own room — listed here so this page stays the one map of everything
          the agents follow.
        </p>
        <ul className="space-y-1 text-sm">
          <li>
            <Link className="font-medium text-accent hover:underline" href="/partners">Partner playbooks</Link>{" "}
            <span className="text-neutral-500">— {also.playbooks} written; read by the motion designer when that partner is on the pursuit</span>
          </li>
          <li>
            <Link className="font-medium text-accent hover:underline" href="/joint">Joint playbooks</Link>{" "}
            <span className="text-neutral-500">— {also.joint} co-edited with partners; cited by the broker</span>
          </li>
          <li>
            <Link className="font-medium text-accent hover:underline" href="/motions">Play templates</Link>{" "}
            <span className="text-neutral-500">— {also.plays} active; the structural backbone of every motion</span>
          </li>
          <li>
            <Link className="font-medium text-accent hover:underline" href="/admin">Brand profile</Link>{" "}
            <span className="text-neutral-500">— {also.brand} configured; the voice of every outbound email</span>
          </li>
        </ul>
      </Card>
    </main>
  );
}
