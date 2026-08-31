/**
 * Stakeholder Intelligence demo story (P1C §18). Synthetic, provenance-labeled, and built through
 * the GOVERNED path (dispatchSkill → assert_stakeholder_role) — never a direct write. Gaps are
 * deliberate: what is MISSING is part of the product story, so the buying committees stay
 * realistically incomplete.
 *
 *   Globex (hero, ~$1.25M, proposal-stage opportunity):
 *     · champion Sarah Kim — first an AGENT-inferred proposal, then superseded VERIFIED by a human
 *       with customer-confirmation evidence (the assertion history is the demo);
 *     · technical buyer Mike Rivera — VERIFIED;
 *     · economic buyer — MISSING. Dana Whitfield (VP Infrastructure) exists only as a contact:
 *       a candidate the product refuses to promote (title ≠ authority);
 *     · influencer Priya Shah — AGENT-inferred proposal (stays inferred);
 *     · warm path: GROUNDED — named sellers hold asserted account relationships here.
 *   Umbrella: economic buyer asserted UNVERIFIED from a title-only basis — UNVERIFIED ≠ MISSING.
 *   Stark Industries: no assertions at all (all MISSING) with partner overlap but no seller
 *     relationship — the "overlap alone is not a warm path" case.
 *   Initech Financial: no relationship evidence of any kind — the honest UNKNOWN warm path.
 *   Globex's second pursuit carries no opportunity — coverage NOT ESTABLISHED (pre-opportunity).
 *
 * Idempotent: contacts upsert on (org, email); an assertion is dispatched only when the stored
 * state differs from the target. Entities resolve BY NAME, so a rebuilt demo world just works.
 *
 *   npx tsx scripts/demo-stakeholder-story.ts
 */
import { Pool, type PoolClient } from "pg";
import { assertSyntheticDatabase } from "../src/lib/env/db-identity";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

/** The account's best pursuit for the story: open, carries an opportunity, highest value. */
async function pursuitWithOpp(db: PoolClient, orgId: string, name: string): Promise<{ pursuitId: string; opportunityId: string } | null> {
  const { rows } = await db.query<{ pursuit_id: string; opportunity_id: string }>(
    `select pu.id pursuit_id, o.id opportunity_id
       from pursuits pu
       join companies c on c.id = pu.account_id
       join opportunities o on o.pursuit_id = pu.id and o.org_id = $1
      where pu.org_id = $1 and c.legal_name ilike $2 and pu.status not in ('WON','LOST','DISQUALIFIED')
      order by (o.stage not like 'closed%') desc, pu.expected_value_weighted desc nulls last
      limit 1`, [orgId, `%${name}%`]);
  return rows[0] ? { pursuitId: rows[0].pursuit_id, opportunityId: rows[0].opportunity_id } : null;
}

async function contact(db: PoolClient, orgId: string, companyName: string, name: string, title: string, email: string): Promise<string> {
  const co = (await db.query<{ id: string }>(`select id from companies where legal_name ilike $1 order by length(legal_name) limit 1`, [`%${companyName}%`])).rows[0];
  if (!co) throw new Error(`company not found: ${companyName}`);
  const { rows } = await db.query<{ id: string }>(
    `insert into contacts (org_id, company_id, email, name, title, contact_type, source)
     values ($1, $2, $3, $4, $5, 'end_user', 'manual')
     on conflict (org_id, email) where source <> 'population'
       do update set name = excluded.name, title = excluded.title, company_id = excluded.company_id
     returning id`, [orgId, co.id, email, name, title]);
  return rows[0].id;
}

async function assertRole(
  db: PoolClient, actor: Actor, pursuitId: string,
  args: { opportunityId: string; contactId: string; role: string; assertionState: string; source: string; evidence?: string; basis?: string[] },
): Promise<void> {
  const cur = (await db.query<{ role: string; assertion_state: string }>(
    `select role, assertion_state from stakeholders where opportunity_id = $1 and contact_id = $2`,
    [args.opportunityId, args.contactId])).rows[0];
  if (cur && cur.role === args.role && cur.assertion_state === args.assertionState) return;   // already told
  const r = await dispatchSkill(db, "assert_stakeholder_role", actor, { pursuitId, args, dataEnvironment: "DEMO" });
  if (r.status !== "EXECUTED") throw new Error(`assert_stakeholder_role ${args.role} ${args.assertionState}: ${r.status} ${r.reason ?? ""}`);
  console.log(`  ✓ ${args.role} — ${args.assertionState} (${args.source})`);
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  // Refuses unless the TARGET database says it is synthetic (0102). An exported
  // production DEMO_URL is the realistic accident; the database answers, not the env.
  await assertSyntheticDatabase(pool, "demo stakeholder seed");
  const db = (await pool.connect()) as PoolClient;
  try {
    await db.query("begin");
    const org = (await db.query<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).rows[0].org_id;
    const user: Actor = { type: "USER", id: null, orgId: org, role: "operator" };
    const agent: Actor = { type: "AGENT", id: null, orgId: org, role: "operator" };

    // ---- Globex: the hero coverage story, with real assertion history --------------------------
    const globex = await pursuitWithOpp(db, org, "Globex");
    if (!globex) throw new Error("Globex pursuit with an opportunity not found");
    const sarah = await contact(db, org, "Globex", "Sarah Kim", "Director, Platform Engineering", "sarah.kim@globex.example");
    const mike = await contact(db, org, "Globex", "Mike Rivera", "Principal Infrastructure Architect", "mike.rivera@globex.example");
    await contact(db, org, "Globex", "Dana Whitfield", "VP Infrastructure", "dana.whitfield@globex.example");  // candidate only — a title, never an assertion
    const priya = await contact(db, org, "Globex", "Priya Shah", "Program Manager, IT Modernization", "priya.shah@globex.example");

    console.log("Globex — governed assertions:");
    // The history moment: an agent proposes, then the customer confirms and a human verifies.
    await assertRole(db, agent, globex.pursuitId, {
      opportunityId: globex.opportunityId, contactId: sarah, role: "champion", assertionState: "inferred",
      source: "ai:conversation", evidence: "Convened the evaluation kickoff; forwarded the brief internally", basis: ["meeting_attendance", "thread_activity"] });
    await assertRole(db, user, globex.pursuitId, {
      opportunityId: globex.opportunityId, contactId: sarah, role: "champion", assertionState: "verified",
      source: "human:customer-confirmation", evidence: "Confirmed on the 12 Aug call she is driving the initiative internally", basis: ["customer_confirmation"] });
    await assertRole(db, user, globex.pursuitId, {
      opportunityId: globex.opportunityId, contactId: mike, role: "technical_buyer", assertionState: "verified",
      source: "human:customer-confirmation", evidence: "Named by the customer as technical sign-off for the platform evaluation", basis: ["customer_confirmation"] });
    await assertRole(db, agent, globex.pursuitId, {
      opportunityId: globex.opportunityId, contactId: priya, role: "influencer", assertionState: "inferred",
      source: "ai:conversation", evidence: "Coordinates the evaluation calendar and attends every session", basis: ["meeting_attendance"] });
    // Economic buyer: deliberately ABSENT. Dana Whitfield stays a candidate contact only.

    // ---- Umbrella: an UNVERIFIED (title-based) proposal — distinct from MISSING ----------------
    const umbrella = await pursuitWithOpp(db, org, "Umbrella");
    if (umbrella) {
      const alex = await contact(db, org, "Umbrella", "Alex Moreau", "CFO", "alex.moreau@umbrella-health.example");
      console.log("Umbrella — governed assertions:");
      await assertRole(db, user, umbrella.pursuitId, {
        opportunityId: umbrella.opportunityId, contactId: alex, role: "economic_buyer", assertionState: "unverified",
        source: "human:pipeline", basis: ["title"] });   // title-only ⇒ may only ever be unverified
    }

    console.log("Stark Industries — deliberately untouched (all roles MISSING; overlap is not a path).");
    console.log("Initech Financial — no relationship evidence at all (warm path UNKNOWN).");
    console.log("Globex's second pursuit — no opportunity (coverage NOT ESTABLISHED).");

    await db.query("commit");
    console.log("\nStakeholder demo story committed (DEMO environment, synthetic provenance).");
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
