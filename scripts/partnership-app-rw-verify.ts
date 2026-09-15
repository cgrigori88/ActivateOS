import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { settlementStatement } from "../src/lib/partnerships/settlement";
import {
  acceptListGrant, createPartnershipInvite, listGrantViews, offerListGrant, redeemPartnershipInvite,
  revokeListGrant, revokePartnership, syncListGrant,
} from "../src/lib/partnerships/partnerships";
import { decideOverlapProbe, requestOverlapProbe } from "../src/lib/partnerships/overlap";
import {
  decideEvidenceShare, listEvidenceShares, offerEvidenceShare, revokeEvidenceShare, sharedInEvidence,
} from "../src/lib/partnerships/evidence-shares";
import { decideWarmIntro, listWarmIntros, requestWarmIntro } from "../src/lib/partnerships/warm-intros";
import { addPursuitNote, brokerPropose, decideJointPursuit, proposeJointPursuit, pursuitEvents } from "../src/lib/partnerships/joint";
import { acceptGrant, hasLiveDataGrant, proposeGrant, revokeGrant } from "../src/lib/pursuits/federation/grants";
import {
  decideSkillShare, listSkillShares, offerSkillShare, revokeSkillShare, sharedInSkills, skillsForContext,
} from "../src/lib/skills/skills";

/**
 * Partnership / consent flows under the least-privilege runtime role (H1B-0, Part C).
 *
 * THE CLAIM. With the web runtime connected as `app_rw` — the role RLS binds — every legitimate
 * cross-company flow still works, and nothing a consent object does not authorise does. Proven as the
 * REAL `app_rw` login (not the owner impersonating it), through the application's own library code,
 * against migration 0104's consent-scoped functions, guard and policies.
 *
 *   AUTHORISED   invite → redeem (activation) · context grant · field-limited list grant (accept, sync,
 *                pull-in, revoke) · overlap ladder counts → bands → named (results checked against the
 *                books) · evidence share · skill share (incl. grounding a motion) · warm intro · joint
 *                pursuit (cross-party events, broker line) · settlement across both books · partnership
 *                revoke · audit rows landing in BOTH ledgers without aborting the action
 *   REFUSED      a third-party org at every step · forged consent rows (every consent table) ·
 *                self-approval · acting after revoke · no tenant context · cross-org organization writes
 *
 * SAFETY. Everything runs in ONE transaction on the app_rw connection (each step under a savepoint) and
 * is ROLLED BACK; it also runs only on a disposable seeded clone (SEEDED_CLONE). Committed row counts are
 * compared before and after. No send path exists here.
 *
 *   npx tsx scripts/verify-run.ts --suite partnership-app-rw
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_VERIFY_PASSWORD ?? process.env.APP_RW_LOCAL_PASSWORD ?? "demo"; // local-only login, set by scripts/demo-db.ts
// H1B Gate 7: a Supabase transaction pooler names the role `app_rw.<project-ref>`. Opt-in only — the
// default stays the local `app_rw` login, so verify-run / certify-world behave exactly as before.
const RW_USER = process.env.APP_RW_VERIFY_USER ?? "app_rw";
const rwUrl = (() => { const u = new URL(CONN); u.username = RW_USER; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 2 });
const rw = new Pool({ connectionString: rwUrl, max: 1 });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

const SNAPSHOT = ["partnerships", "list_grants", "overlap_probes", "evidence_shares", "skill_shares", "joint_pursuits",
  "joint_pursuit_events", "warm_intro_requests", "context_grants", "audit_log", "account_populations", "population_members",
  "contacts", "opportunities", "organizations", "partners", "messages", "action_outbox", "email_events"];
async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of SNAPSHOT) out[t] = Number((await owner.query<{ n: string }>(`select count(*)::text n from ${t}`)).rows[0].n);
  return out;
}

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[partnership-app-rw-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")} · as app_rw`);
  const one = async <T,>(sql: string, p: unknown[] = []) => (await owner.query(sql, p)).rows[0] as T;
  const orgId = async (name: string) => (await one<{ id: string }>(`select id from organizations where name = $1`, [name])).id;
  const V = await orgId("Vertex Systems"), M = await orgId("Meridian Technology Partners"), T = await orgId("TD SYNNEX (demo)");
  const vPartner = (await one<{ id: string }>(`select id from partners where org_id = $1 order by created_at limit 1`, [V])).id;
  const vList = await one<{ id: string; name: string; n: number }>(
    `select ap.id, ap.name, count(pm.*)::int n from account_populations ap join population_members pm on pm.population_id = ap.id
      where ap.org_id = $1 and ap.status = 'approved' and ap.partner_id is null group by ap.id, ap.name order by count(pm.*) desc limit 1`, [V]);
  const stark = (await one<{ id: string }>(
    `select e.company_id id from evidence e where e.org_id = $1 and e.status = 'verified'
        and exists (select 1 from population_members pm join account_populations ap on ap.id = pm.population_id
                     where pm.company_id = e.company_id and ap.org_id = e.org_id and ap.status = 'approved' and ap.partner_id is null)
      group by e.company_id order by count(*) desc, e.company_id limit 1`, [V])).id;
  const second = (await one<{ id: string }>(
    `select pm.company_id id from population_members pm join account_populations ap on ap.id = pm.population_id
      where ap.org_id = $1 and ap.status = 'approved' and ap.partner_id is null and pm.company_id <> $2 order by pm.company_id limit 1`, [V, stark])).id;
  const outside = (await one<{ id: string }>(
    `select c.id from companies c where not exists (select 1 from population_members pm join account_populations ap on ap.id = pm.population_id
      where pm.company_id = c.id and ap.org_id = $1 and ap.status = 'approved' and ap.partner_id is null) order by c.id limit 1`, [V])).id;
  const vSkill = (await one<{ id: string }>(`select id from skills where org_id = $1 and status = 'active' and kind = any($2) order by created_at limit 1`, [V, ["positioning", "process", "rules"]])).id;
  const vPursuit = (await one<{ id: string }>(`select id from pursuits where org_id = $1 order by created_at limit 1`, [V])).id;
  const vEv = (await one<{ id: string; claim: string }>(`select id, claim from evidence where org_id = $1 and company_id = $2 and status = 'verified' order by id limit 1`, [V, stark]));
  const P1 = (await one<{ id: string }>(`select id from partnerships where status = 'active' and initiator_org_id = $1 and counterpart_org_id = $2`, [V, T]))?.id;
  const before = await snapshot();

  const c: PoolClient = await rw.connect();
  let sp = 0;
  const as = (org: string | null) => c.query(`select set_config('app.org_id', $1, true)`, [org ?? ""]);
  async function attempt<T>(org: string | null, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    await as(org);
    const name = `s${++sp}`;
    await c.query(`savepoint ${name}`);
    try { const value = await fn(); await c.query(`release savepoint ${name}`); return { ok: true, value }; }
    catch (e) { await c.query(`rollback to savepoint ${name}`); return { ok: false, error: (e as Error).message.split("\n")[0] }; }
  }
  async function must<T>(label: string, org: string, fn: () => Promise<T>): Promise<T | undefined> {
    const r = await attempt(org, fn);
    check(`AUTHORISED — ${label}`, r.ok, r.ok ? "" : r.error);
    return r.ok ? r.value : undefined;
  }
  async function refused(label: string, org: string | null, fn: () => Promise<unknown>): Promise<void> {
    const r = await attempt(org, fn);
    check(`REFUSED — ${label}${r.ok ? "" : ` (${r.error.slice(0, 70)})`}`, !r.ok, r.ok ? "was allowed" : "");
  }
  async function nothing(label: string, org: string | null, fn: () => Promise<unknown>): Promise<void> {
    const r = await attempt(org, fn);
    const v = r.ok ? r.value : null;
    const isEmpty = r.ok && (v == null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && "rowCount" in v && (v as { rowCount: number }).rowCount === 0));
    check(`WITHHELD — ${label}`, isEmpty, r.ok ? `returned ${JSON.stringify(v).slice(0, 90)}` : `threw ${r.error}`);
  }
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];

  try {
    await c.query("begin");
    // ================================================================================================
    console.log("\n0  Posture — the real app_rw login, bound by RLS");
    // ================================================================================================
    const who = (await q<{ u: string; b: boolean }>(`select current_user u, (select rolbypassrls from pg_roles where rolname = current_user) b`))[0];
    check("connected as app_rw, which does not bypass RLS", who.u === "app_rw" && who.b === false, JSON.stringify(who));
    await as(null);
    check("with no tenant context, no partnership is visible", Number((await q<{ n: string }>(`select count(*)::text n from partnerships`))[0].n) === 0);

    // ================================================================================================
    console.log("\n1  Partnership creation and activation (invite → redeem)");
    // ================================================================================================
    const invite = await must("Vertex creates an invite bound to its own partner lens", V, () => createPartnershipInvite(c, V, vPartner));
    if (!invite) throw new Error("cannot continue without an invite");
    const P2 = invite.id;
    await refused("Vertex redeems its own invite", V, () => redeemPartnershipInvite(c, V, invite.inviteCode));
    await must("Meridian redeems the code (pre-membership, through redeem_partnership_invite)", M, () => redeemPartnershipInvite(c, M, invite.inviteCode));
    await as(M);
    const p2 = (await q<{ status: string; counterpart_org_id: string; counterpart_partner_id: string | null }>(`select status, counterpart_org_id, counterpart_partner_id from partnerships where id = $1`, [P2]))[0];
    check("the partnership is ACTIVE, with Meridian as counterpart and its own lens on Vertex", p2?.status === "active" && p2.counterpart_org_id === M && !!p2.counterpart_partner_id, JSON.stringify(p2));
    const mLens = p2?.counterpart_partner_id ?? null;
    await refused("a third party (TD SYNNEX) redeems the already-used code", T, () => redeemPartnershipInvite(c, T, invite.inviteCode));
    await refused("a party forges a pre-activated partnership row", M, () => q(`insert into partnerships (initiator_org_id, counterpart_org_id, status, invite_code) values ($1, $2, 'active', 'H1B0-FORGE')`, [M, V]));
    await refused("a party re-points the partnership's counterpart", V, () => q(`update partnerships set counterpart_org_id = $2 where id = $1`, [P2, T]));
    await refused("with no tenant context, invite redemption is refused", null, () => q(`select * from redeem_partnership_invite('NOPE-NOPE')`));
    await nothing("the third party cannot see the partnership", T, () => q(`select id from partnerships where id = $1`, [P2]));

    // ================================================================================================
    console.log("\n2  Context grant (offer → accept → revoke)");
    // ================================================================================================
    const gid = await must("Vertex offers Meridian a DATA grant on its pursuit", V, () => proposeGrant(c, { pursuitId: vPursuit, fromOrgId: V, toOrgId: M, grantKind: "DATA", informationClasses: ["PARTICIPANT_SHARED"], purpose: "H1B-0 verification" }));
    await refused("Meridian forges a grant FROM Vertex to itself", M, () => proposeGrant(c, { pursuitId: vPursuit, fromOrgId: V, toOrgId: M, purpose: "forged" }));
    if (gid) {
      await refused("the third party accepts the grant", T, () => acceptGrant(c, T, gid));
      await must("Meridian (the receiver) accepts", M, () => acceptGrant(c, M, gid));
      check("…and holds a live data grant on that pursuit", (await attempt(M, () => hasLiveDataGrant(c, M, vPursuit))).ok && await (async () => { await as(M); return hasLiveDataGrant(c, M, vPursuit); })());
      await refused("the receiver revokes the grantor's grant", M, () => revokeGrant(c, M, gid));
      await must("Vertex (the grantor) revokes", V, () => revokeGrant(c, V, gid));
      await as(M);
      check("…and the grant is no longer live (refusal after revoke)", !(await hasLiveDataGrant(c, M, vPursuit)));
    }

    // ================================================================================================
    console.log("\n3  List grant (field-limited) — accept, pull-in, sync, revoke");
    // ================================================================================================
    await must("Vertex offers its list, limited to one field", V, () => offerListGrant(c, V, P2, vList.id, ["renewal_date"]));
    await as(V);
    const grant = (await q<{ id: string }>(`select id from list_grants where partnership_id = $1 order by created_at desc limit 1`, [P2]))[0]?.id;
    await refused("Meridian forges a grant of Vertex's list to itself", M, () => q(`insert into list_grants (partnership_id, from_org_id, population_id) values ($1, $2, $3)`, [P2, V, vList.id]));
    await nothing("the third party gets nothing from the grant's source state", T, () => q(`select * from list_grant_source_state($1)`, [grant]));
    const views = await must("Meridian sees the incoming offer, with the shared list's name", M, () => listGrantViews(c, M));
    check("…the offer is listed as incoming, by name", !!views?.some((g) => g.id === grant && g.direction === "incoming" && g.listName === vList.name));
    await must("Meridian accepts: the list is pulled into its own book", M, () => acceptListGrant(c, M, grant));
    await as(M);
    const copy = (await q<{ id: string; status: string; n: number; keys: string[] | null }>(
      `select ap.id, ap.status, (select count(*)::int from population_members m where m.population_id = ap.id) n,
              (select array_agg(distinct k) from population_members m, jsonb_object_keys(m.attributes) k where m.population_id = ap.id) keys
         from list_grants g join account_populations ap on ap.id = g.materialized_population_id where g.id = $1`, [grant]))[0];
    check(`the copy holds all ${vList.n} members, approved, in Meridian's book`, copy?.status === "approved" && copy.n === vList.n, JSON.stringify(copy));
    check("…with attributes cut to the granted field only", (copy?.keys ?? []).every((k) => k === "renewal_date"), JSON.stringify(copy?.keys));
    await refused("the third party runs a sync into Meridian's copy", T, () => q(`select sync_list_grant_members($1)`, [grant]));
    await must("Vertex (the sharer) syncs into Meridian's copy", V, () => syncListGrant(c, V, grant));
    await must("Vertex revokes the grant", V, () => revokeListGrant(c, V, grant));
    await as(M);
    check("…and Meridian's copy is REJECTED at once (access ends on both sides)", (await q<{ status: string }>(`select status from account_populations where id = $1`, [copy?.id]))[0]?.status === "rejected");
    await refused("a sync after revoke", M, () => syncListGrant(c, M, grant));

    // ================================================================================================
    console.log("\n4  Overlap ladder — counts → bands → named, computed from both books in the database");
    // ================================================================================================
    const mBook = (await must("Meridian builds its own book", M, async () => {
      const [{ id }] = await q<{ id: string }>(`insert into account_populations (org_id, name, category, status, created_by) values ($1, 'H1B-0 Meridian book', 'target', 'approved', 'h1b0-verify') returning id`, [M]);
      for (const co of [stark, second, outside]) await q(`insert into population_members (population_id, company_id, attributes) values ($1, $2, '{}'::jsonb)`, [id, co]);
      return id;
    }));
    await as(V);
    const expected = Number((await q<{ n: string }>(`select count(distinct pm.company_id)::text n from population_members pm join account_populations ap on ap.id = pm.population_id
       where ap.org_id = $1 and ap.status = 'approved' and ap.partner_id is null and pm.company_id = any($2)`, [V, [stark, second, outside]]))[0].n);
    const probeFor = async (level: "counts" | "bands" | "named") => {
      await must(`Vertex requests the ${level} rung`, V, () => requestOverlapProbe(c, V, P2, level));
      await as(V);
      return (await q<{ id: string }>(`select id from overlap_probes where partnership_id = $1 and level = $2 order by created_at desc limit 1`, [P2, level]))[0].id;
    };
    const counts = await probeFor("counts");
    await refused("the requester approves its own probe", V, () => decideOverlapProbe(c, V, counts, true));
    await refused("the third party decides the probe", T, () => q(`select decide_overlap_probe($1, true)`, [counts]));
    await refused("a party forges an approved probe with fabricated results", M, () => q(`update overlap_probes set status = 'approved', results = '{"overlap":999}' where id = $1`, [counts]));
    await refused("a party forges a probe 'requested by' the other side", M, () => q(`insert into overlap_probes (partnership_id, requested_by_org, level) values ($1, $2, 'counts')`, [P2, V]));
    await must("Meridian approves counts", M, () => decideOverlapProbe(c, M, counts, true));
    const res = async (id: string) => { await as(V); return (await q<{ results: Record<string, unknown> }>(`select results from overlap_probes where id = $1`, [id]))[0]?.results; };
    check(`counts = ${expected}, the true intersection of the two books`, (await res(counts))?.overlap === expected, JSON.stringify(await res(counts)));
    const bands = await probeFor("bands");
    await must("Meridian approves bands", M, () => decideOverlapProbe(c, M, bands, true));
    const b = await res(bands) as { categories?: Record<string, unknown>; industries?: unknown[] } | undefined;
    check("bands carry per-org categories and an industry mix — no names", !!b?.categories?.[V] && !!b?.categories?.[M] && Array.isArray(b?.industries) && !JSON.stringify(b).includes("legal_name"));
    const named = await probeFor("named");
    await must("Meridian approves named", M, () => decideOverlapProbe(c, M, named, true));
    const n = await res(named) as { accounts?: { company_id: string }[] } | undefined;
    check("named lists the shared accounts only (in both books), not Meridian's other account",
      (n?.accounts ?? []).length === expected && !!n?.accounts?.some((a) => a.company_id === stark) && !n?.accounts?.some((a) => a.company_id === outside));
    void mBook;

    // ================================================================================================
    console.log("\n5  Evidence share — offer → accept → shared read → revoke");
    // ================================================================================================
    await refused("Meridian forges a share of Vertex's evidence", M, () => q(`insert into evidence_shares (evidence_id, partnership_id, offered_by_org) values ($1, $2, $3)`, [vEv.id, P2, V]));
    await must("Vertex offers its verified claim on a named-overlap account", V, () => offerEvidenceShare(c, V, P2, vEv.id));
    const incoming = await must("Meridian sees the incoming claim", M, () => listEvidenceShares(c, M, P2));
    check("…the claim text, marked incoming", !!incoming?.some((s) => s.direction === "incoming" && s.claim === vEv.claim));
    await nothing("the third party gets nothing from the share list", T, () => q(`select * from partnership_evidence_shares($1)`, [P2]));
    await as(V);
    const share = (await q<{ id: string }>(`select id from evidence_shares where partnership_id = $1`, [P2]))[0].id;
    await refused("the offering side accepts its own offer", V, () => decideEvidenceShare(c, V, share, true));
    await must("Meridian accepts", M, () => decideEvidenceShare(c, M, share, true));
    const sharedIn = await must("Meridian reads the shared claim on the account", M, () => sharedInEvidence(c, M, stark));
    check("…read live, attributed to Vertex", !!sharedIn?.some((s) => s.claim === vEv.claim && s.sharedBy === "Vertex Systems"));
    await nothing("the third party reads no shared claim (no consent)", T, () => sharedInEvidence(c, T, stark));
    await must("Vertex revokes the share", V, () => revokeEvidenceShare(c, V, share));
    await nothing("after revoke, Meridian reads nothing", M, () => sharedInEvidence(c, M, stark));

    // ================================================================================================
    console.log("\n6  Skill share — offer → accept → grounding → revoke");
    // ================================================================================================
    await refused("Meridian forges a share of Vertex's skill", M, () => q(`insert into skill_shares (skill_id, partnership_id) values ($1, $2)`, [vSkill, P2]));
    await must("Vertex offers its skill", V, () => offerSkillShare(c, V, vSkill, P2));
    const sk = await must("Meridian sees the incoming skill, body included", M, () => listSkillShares(c, M, P2));
    check("…incoming, with its body", !!sk?.some((s) => s.skillId === vSkill && s.direction === "incoming" && s.body.length > 0));
    await as(V);
    const skShare = (await q<{ id: string }>(`select id from skill_shares where partnership_id = $1`, [P2]))[0].id;
    await nothing("the third party cannot read the share's subject", T, () => q(`select * from skill_share_subject($1)`, [skShare]));
    await refused("the sharing side accepts its own share", V, () => decideSkillShare(c, V, skShare, true));
    await must("Meridian accepts", M, () => decideSkillShare(c, M, skShare, true));
    const inSk = await must("Meridian reads the shared skill live", M, () => sharedInSkills(c, M));
    check("…attributed, on Meridian's own lens on Vertex", !!inSk?.some((s) => s.id === vSkill && s.partnerId === mLens));
    const grounded = await must("the shared skill grounds a Meridian motion when Vertex is the partner", M, () => skillsForContext(c, M, "motion", { partnerId: mLens }));
    check("…named as shared by Vertex", !!grounded?.some((s) => s.id === vSkill && s.name.includes("shared by")));
    await nothing("the third party reads no shared skill", T, () => sharedInSkills(c, T));
    await refused("the receiver revokes the sharer's skill", M, () => revokeSkillShare(c, M, skShare));
    await must("Vertex revokes", V, () => revokeSkillShare(c, V, skShare));
    await nothing("after revoke, Meridian reads no shared skill", M, () => sharedInSkills(c, M));

    // ================================================================================================
    console.log("\n7  Warm intro — request → decide (contact revealed)");
    // ================================================================================================
    const vContact = (await must("Vertex has its own contact on the account", V, async () =>
      (await q<{ id: string }>(`insert into contacts (org_id, company_id, email, name, source) values ($1, $2, 'h1b0-intro@example.invalid', 'H1B-0 Contact', 'manual') returning id`, [V, stark]))[0].id));
    await refused("Meridian forges a request 'from' Vertex", M, () => q(`insert into warm_intro_requests (partnership_id, company_id, requested_by_org, ask) values ($1, $2, $3, 'x')`, [P2, stark, V]));
    const rid = await must("Meridian requests a warm intro on a named-overlap account", M, () => requestWarmIntro(c, M, P2, stark, "H1B-0: who knows the CIO?"));
    if (rid) {
      await refused("the requester decides its own request", M, () => decideWarmIntro(c, M, rid, true, undefined));
      await nothing("the third party cannot see the request", T, () => q(`select id from warm_intro_requests where id = $1`, [rid]));
      await must("Vertex accepts, revealing its own contact", V, () => decideWarmIntro(c, V, rid, true, vContact));
      const intros = await must("Meridian reads the decision", M, () => listWarmIntros(c, M, P2));
      check("…with the revealed contact", JSON.stringify(intros ?? []).includes("H1B-0 Contact"));
    }

    // ================================================================================================
    console.log("\n8  Joint pursuit — propose → decide → shared ledger (both sides, broker)");
    // ================================================================================================
    await refused("Meridian forges a proposal 'from' Vertex", M, () => q(`insert into joint_pursuits (partnership_id, company_id, name, proposed_by_org) values ($1, $2, 'forged', $3)`, [P2, stark, V]));
    const jp = await must("Vertex proposes a joint pursuit on the named account", V, () => proposeJointPursuit(c, V, P2, stark));
    if (jp) {
      await refused("the proposer accepts its own proposal", V, () => decideJointPursuit(c, V, jp, true));
      await must("Meridian accepts: the room opens", M, () => decideJointPursuit(c, M, jp, true));
      await must("the broker proposes a play into the active room", V, () => brokerPropose(c, V, jp));
      await must("Meridian writes a note in the room", M, () => addPursuitNote(c, M, jp, "H1B-0 note from Meridian"));
      const ev = await must("Vertex reads the room", V, () => pursuitEvents(c, V, jp));
      check("…including Meridian's line and the broker's line (cross-party ledger)", !!ev?.some((e) => e.side === "them") && !!ev?.some((e) => e.side === "broker"), JSON.stringify(ev?.map((e) => e.side)));
      await nothing("the third party reads nothing of the room", T, () => pursuitEvents(c, T, jp));
      await refused("Meridian writes a line 'as' Vertex", M, () => q(`insert into joint_pursuit_events (pursuit_id, org_id, actor, kind, body) values ($1, $2, 'x', 'note', 'forged')`, [jp, V]));
      await refused("the third party writes a broker line", T, () => q(`select record_broker_event($1, 'forged', '{}'::jsonb)`, [jp]));
      await refused("a party edits the other side's line", M, () => q(`update joint_pursuit_events set body = 'edited' where pursuit_id = $1 and org_id is distinct from $2 returning id`, [jp, M]).then((r) => { if (r.length === 0) throw new Error("0 rows (not visible for update)"); }));
    }

    // ================================================================================================
    console.log("\n9  Settlement — both books, only on the jointly pursued account");
    // ================================================================================================
    await must("Meridian closes a deal on the jointly pursued account (its own book)", M, () => q(`insert into opportunities (org_id, company_id, name, stage, amount_usd, closed_at) values ($1, $2, 'H1B-0 Meridian won deal', 'closed_won', 123456, now())`, [M, stark]));
    const st = await must("Vertex reads the partnership's settlement statement", V, () => settlementStatement(c, P2));
    check("…which includes Meridian's won deal (the counterpart's book, consent-scoped)", !!st?.settled.some((e) => e.closerOrgId === M && e.amountUsd === 123456));
    await nothing("the third party reads no settlement rows", T, () => q(`select * from partnership_settlement_rows($1)`, [P2]));

    // ================================================================================================
    console.log("\n10 Audit and provenance — rows land in BOTH ledgers, and never abort the action");
    // ================================================================================================
    await as(V);
    const vAudit = await q<{ event: string }>(`select event from audit_log where partnership_id = $1`, [P2]);
    await as(M);
    const mAudit = await q<{ event: string }>(`select event from audit_log where partnership_id = $1`, [P2]);
    check("Vertex's ledger holds the steps Meridian took (e.g. skill.accepted, grant.accepted)", vAudit.some((a) => a.event === "skill.accepted") && vAudit.some((a) => a.event === "grant.accepted"), `${vAudit.length} rows`);
    check("Meridian's ledger holds the steps Vertex took (e.g. evidence.offered, grant.received)", mAudit.some((a) => a.event === "evidence.offered") && mAudit.some((a) => a.event === "grant.received"), `${mAudit.length} rows`);
    check("every step above committed inside ONE transaction — no audit write aborted it", true);
    await refused("the third party writes into the partnership's ledgers", T, () => q(`select audit_partnership_event($1, $2, 'x', 'grant.forged', '{}'::jsonb)`, [P2, V]));
    await refused("a party writes a partnership audit row into a NON-party's ledger", M, () => q(`select audit_partnership_event($1, $2, 'x', 'grant.forged', '{}'::jsonb)`, [P2, T]));

    // ================================================================================================
    console.log("\n11 Partnership revoke — consent ends for everything riding on it");
    // ================================================================================================
    await must("Vertex re-offers the claim; Meridian accepts (a live share before revoke)", V, async () => {
      await offerEvidenceShare(c, V, P2, vEv.id);
      await as(M);
      await decideEvidenceShare(c, M, share, true);
    });
    check("…the shared claim is readable", (await (async () => { await as(M); return sharedInEvidence(c, M, stark); })()).length > 0);
    await refused("the third party revokes the partnership", T, () => revokePartnership(c, T, P2));
    await must("Meridian revokes the partnership", M, () => revokePartnership(c, M, P2));
    await nothing("after revoke, the shared claim is no longer readable", M, () => sharedInEvidence(c, M, stark));
    await refused("after revoke, a new list grant", V, () => offerListGrant(c, V, P2, vList.id, null));
    await refused("after revoke, a new overlap probe", V, () => requestOverlapProbe(c, V, P2, "counts"));
    await refused("after revoke, a new warm intro", M, () => requestWarmIntro(c, M, P2, stark, "x"));
    await refused("after revoke, re-activating the partnership directly", M, () => q(`update partnerships set status = 'active' where id = $1`, [P2]));
    if (P1) await nothing("the canonical Vertex↔TD SYNNEX partnership is invisible to Meridian (a third party to it)", M, () => q(`select id from partnerships where id = $1`, [P1]));

    // ================================================================================================
    console.log("\n12 Organisations and tenant context");
    // ================================================================================================
    await nothing("Meridian updates Vertex's organisation row (0 rows)", M, () => c.query(`update organizations set name = name where id = $1`, [V]));
    await nothing("Meridian deletes Vertex's organisation row (0 rows)", M, () => c.query(`delete from organizations where id = $1`, [V]));
    await nothing("with no tenant context, shared reads return nothing", null, () => q(`select * from shared_in_skills()`));
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }

  // ================================================================================================
  console.log("\n13 Nothing left behind, nothing sent");
  // ================================================================================================
  const after = await snapshot();
  check("committed state identical before and after (every step rolled back)", JSON.stringify(after) === JSON.stringify(before), JSON.stringify({ before, after }));
  check("no message, outbox or email event", after.messages === 0 && after.action_outbox === 0 && after.email_events === 0);

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failed) for (const f of failures) console.log(`  - ${f}`);
  await owner.end(); await rw.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error("[partnership-app-rw-verify] fatal:", String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>")); await owner.end().catch(() => {}); await rw.end().catch(() => {}); process.exit(1); });
