import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Skills library (task #84): the org's collective playbook as typed,
 * governed rows — not prompts in people's heads or a folder 10% of the
 * team knows about.
 *
 * Deliberately TYPED and SCOPED (the anti-slop design):
 *  - kind names what a skill IS (positioning / process / style / rules),
 *  - scope names where it applies (whole org, one partner, one list),
 *  - the surface registry below declares which agents read which kinds —
 *    so "where does this ground?" always has an answer, and near-duplicates
 *    are visible at creation time instead of needing cleanup later.
 *
 * Usage is attributed, not guessed: every agent run records the skill ids
 * that grounded it (agent_runs.skill_ids), so the library can rank skills
 * by what they actually did.
 */

export type SkillKind = "positioning" | "process" | "style" | "rules";
export type SkillScope = "org" | "partner" | "list";

export const SKILL_KINDS: { kind: SkillKind; label: string; hint: string; surfaces: string[] }[] = [
  {
    kind: "positioning",
    label: "Positioning",
    hint: "How we tell the story — value framing, differentiation, what to lead with.",
    surfaces: ["Motion designer", "Campaign composer"],
  },
  {
    kind: "process",
    label: "Process",
    hint: "How work runs — qualification steps, deal registration, handoffs.",
    surfaces: ["Motion designer", "Campaign composer"],
  },
  {
    kind: "style",
    label: "Style",
    hint: "How we sound — tone, phrasing, what never to say in customer-facing copy.",
    surfaces: ["Campaign composer"],
  },
  {
    kind: "rules",
    label: "Rules",
    hint: "Hard boundaries — accounts or claims that are off-limits, compliance lines.",
    surfaces: ["Motion designer", "Campaign composer"],
  },
];

/** Which kinds each agent surface reads — the injection contract, in one place. */
export const SURFACE_KINDS: Record<"motion" | "campaign", SkillKind[]> = {
  motion: ["positioning", "process", "rules"],
  campaign: ["positioning", "process", "style", "rules"],
};

export interface Skill {
  id: string;
  name: string;
  kind: SkillKind;
  scopeType: SkillScope;
  scopeId: string | null;
  scopeLabel: string;
  body: string;
  status: "active" | "archived";
  createdBy: string | null;
  updatedAt: string;
  uses: number;
  lastUsedAt: string | null;
}

export async function listSkills(db: Db, orgId: string): Promise<Skill[]> {
  const { rows } = await db.query<{
    id: string; name: string; kind: SkillKind; scope_type: SkillScope; scope_id: string | null;
    body: string; status: "active" | "archived"; created_by: string | null; updated_at: Date;
    scope_label: string | null; uses: string; last_used_at: Date | null;
  }>(
    `select s.id, s.name, s.kind, s.scope_type, s.scope_id, s.body, s.status, s.created_by, s.updated_at,
            case s.scope_type
              when 'partner' then (select p.name from partners p where p.id = s.scope_id)
              when 'list' then (select ap.name from account_populations ap where ap.id = s.scope_id)
              else null end as scope_label,
            coalesce(u.uses, 0)::text as uses, u.last_used_at
     from skills s
     left join (select unnest(skill_ids) as skill_id, count(*) as uses, max(created_at) as last_used_at
                from agent_runs where org_id = $1 group by 1) u on u.skill_id = s.id
     where s.org_id = $1
     order by s.status asc, u.uses desc nulls last, s.updated_at desc`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    scopeLabel: r.scope_type === "org" ? "Whole org" : r.scope_label ?? "(deleted scope)",
    body: r.body,
    status: r.status,
    createdBy: r.created_by,
    updatedAt: new Date(r.updated_at).toISOString().slice(0, 10),
    uses: Number(r.uses),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString().slice(0, 10) : null,
  }));
}

export async function createSkill(
  db: Db,
  orgId: string,
  s: { name: string; kind: SkillKind; scopeType: SkillScope; scopeId: string | null; body: string; createdBy?: string },
): Promise<void> {
  const name = s.name.trim().slice(0, 120);
  const body = s.body.trim().slice(0, 6000);
  if (!name) throw new Error("Give the skill a name.");
  if (!body) throw new Error("Write the skill's instructions.");
  if (s.scopeType !== "org" && !s.scopeId) throw new Error("Pick the partner or list this skill applies to.");
  if (s.scopeType === "partner" && s.scopeId) {
    const { rows } = await db.query(`select 1 from partners where id = $1 and org_id = $2`, [s.scopeId, orgId]);
    if (rows.length === 0) throw new Error("Unknown partner for this organization.");
  }
  if (s.scopeType === "list" && s.scopeId) {
    const { rows } = await db.query(`select 1 from account_populations where id = $1 and org_id = $2`, [s.scopeId, orgId]);
    if (rows.length === 0) throw new Error("Unknown list for this organization.");
  }
  const { rows: dup } = await db.query(`select 1 from skills where org_id = $1 and lower(name) = lower($2)`, [orgId, name]);
  if (dup.length > 0) throw new Error(`A skill named "${name}" already exists — edit it instead of duplicating.`);
  await db.query(
    `insert into skills (org_id, name, kind, scope_type, scope_id, body, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [orgId, name, s.kind, s.scopeType, s.scopeType === "org" ? null : s.scopeId, body, s.createdBy ?? null],
  );
}

export async function updateSkillBody(db: Db, orgId: string, id: string, body: string): Promise<void> {
  const trimmed = body.trim().slice(0, 6000);
  if (!trimmed) throw new Error("A skill can't be empty — archive it instead.");
  const { rowCount } = await db.query(
    `update skills set body = $3, updated_at = now() where id = $1 and org_id = $2`,
    [id, orgId, trimmed],
  );
  if (!rowCount) throw new Error("Skill not found.");
}

export async function setSkillStatus(db: Db, orgId: string, id: string, status: "active" | "archived"): Promise<void> {
  const { rowCount } = await db.query(
    `update skills set status = $3, updated_at = now() where id = $1 and org_id = $2`,
    [id, orgId, status],
  );
  if (!rowCount) throw new Error("Skill not found.");
}

/**
 * The skills that ground one agent run: org-wide skills, skills scoped to
 * the partner on the pursuit, and skills scoped to any approved list the
 * account sits on — filtered to the kinds this surface reads.
 */
export async function skillsForContext(
  db: Db,
  orgId: string,
  surface: keyof typeof SURFACE_KINDS,
  ctx: { companyId?: string | null; partnerId?: string | null },
): Promise<{ id: string; name: string; kind: SkillKind; body: string }[]> {
  const kinds = SURFACE_KINDS[surface];
  const { rows } = await db.query<{ id: string; name: string; kind: SkillKind; body: string }>(
    `select s.id, s.name, s.kind, s.body from skills s
     where s.org_id = $1 and s.status = 'active' and s.kind = any($2)
       and (s.scope_type = 'org'
            or (s.scope_type = 'partner' and $3::uuid is not null and s.scope_id = $3)
            or (s.scope_type = 'list' and $4::uuid is not null and exists (
                  select 1 from population_members pm
                  join account_populations ap on ap.id = pm.population_id and ap.status = 'approved'
                  where pm.population_id = s.scope_id and pm.company_id = $4)))
     order by s.scope_type desc, s.updated_at desc
     limit 8`,
    [orgId, kinds, ctx.partnerId ?? null, ctx.companyId ?? null],
  );
  return rows;
}

/** Render skills as a prompt section. Empty list → empty string (no section). */
export function renderSkillsSection(skills: { name: string; kind: SkillKind; body: string }[]): string {
  if (skills.length === 0) return "";
  const label = (k: SkillKind) => SKILL_KINDS.find((s) => s.kind === k)?.label ?? k;
  return (
    `## Team skills (curated instructions from this organization — follow them)\n` +
    skills.map((s) => `### ${s.name} (${label(s.kind)})\n${s.body.slice(0, 2000)}`).join("\n") +
    `\n`
  );
}
