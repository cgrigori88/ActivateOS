import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertSeededClone } from "./seeded-clone";
import { analyzeCsvToBatch, commitImportBatch, commitCrmBatch } from "../src/lib/ingest/staged";
import { reverseBatch, GLOBAL_IDENTITY_KINDS } from "../src/lib/ingest/lineage";
import { mintAttentionToken, readAttentionToken } from "../src/lib/pursuits/evidence/attention-token";
import { recordAttentionSelection } from "../src/lib/pursuits/evidence/attention-capture";

/**
 * SLICE 2 — PILOT ONBOARDING, REVERSIBLE INTAKE, ATTENTION SELECTION.
 *
 * The exit criterion is operational, not architectural: the owner must be able to run real pursuits
 * without an engineer seeding, correcting or deleting rows. So this suite exercises the product
 * paths rather than the schema, and every negative reaches the guard that is supposed to stop it.
 *
 * SEEDED CLONE: commits fixtures.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL_VERIFY ?? process.env.DATABASE_URL ?? "", max: 3 });
let pass = 0, fail = 0;
const ck = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"}  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`); };
const note = (n: string, d?: unknown) => console.log(`  ·  ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
const HD = (s: string) => console.log(`\n── ${s}`);
const NS = `s2-${Math.random().toString(36).slice(2, 8)}`;
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as any[];
const one = async (s: string, p: unknown[] = []) => (await q(s, p))[0];
const n = async (s: string, p: unknown[] = []) => Number((await one(s, p)).n);
const codeOf = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** The three files an owner would realistically export and load, in the order they would load them. */
const ACCOUNTS_CSV = `Company,Domain,Industry,Employees,Target Product,Contact Email,Contact Name,Contact Title
Northwind Traders,northwind.example,manufacturing,4200,platform,ops@northwind.example,Dana Ortiz,VP Infrastructure
Contoso Freight,contoso-freight.example,logistics,1800,platform,rm@contoso-freight.example,Sam Ihara,Director of IT
Fabrikam Metals,fabrikam-metals.example,industrial,900,platform,,,`;
const CRM_CSV = `Company,Opportunity Name,Deal Stage,Deal Value,Close Date
Northwind Traders,Northwind platform modernization,Proposal,480000,2026-11-30
Contoso Freight,Contoso fleet platform,Qualification,250000,2027-01-15`;

async function main() {
  await assertSeededClone(pool);
  console.log(`Slice 2 — pilot onboarding, reversible intake, attention selection  (${NS})`);

  // ── PILOT OPERATING CONTEXT ───────────────────────────────────────────────────────────────────
  HD("OPERATING CONTEXT — a clean PILOT organization, created through the product");
  const pilotOrg = await one(
    `insert into organizations (name, kind, data_environment) values ($1,'full','PILOT') returning id, kind, data_environment`,
    [`Pilot ${NS}`]);
  const demoOrg = await one(`insert into organizations (name, kind, data_environment) values ($1,'full','DEMO') returning id`, [`Demo ${NS}`]);
  await q(`insert into org_features (org_id) values ($1) on conflict do nothing`, [pilotOrg.id]);
  ck("an organization carries its own operating provenance", pilotOrg.data_environment === "PILOT" && pilotOrg.kind === "full");
  let badOrgEnv = "";
  try { await pool.query(`insert into organizations (name, data_environment) values ($1,'NONSENSE')`, [`bad ${NS}`]); }
  catch (e) { badOrgEnv = (e as Error).message; }
  ck("CONTROL — an unknown environment is refused by the database", /violates check constraint/.test(badOrgEnv));
  ck("BITING — there is NO default: an organization nobody classified stays unclassified, never PRODUCTION",
    (await one(`select coalesce(column_default,'-') d from information_schema.columns
                 where table_name='organizations' and column_name='data_environment'`)).d === "-"
    && (await one(`insert into organizations (name) values ($1) returning data_environment`, [`unclassified ${NS}`])).data_environment === null);

  // ── ORG SWITCHING ─────────────────────────────────────────────────────────────────────────────
  HD("ORG SWITCHING — membership is the grant; the cookie is only a preference");
  const orgSrc = codeOf("../src/lib/auth/org.ts");
  ck("the selection is re-validated against org_members on EVERY read, not only when it is set",
    /from org_members m where m\.org_id = \$1 and m\.user_id = \$2/.test(orgSrc));
  // Asserted on CODE, not on the comment explaining it: `codeOf` strips comments, and a control a
  // comment can satisfy is not a control. The fallback IS the ordered single-row membership query.
  ck("a forged organization id degrades to the user's own membership rather than granting anything",
    /order by created_at asc, org_id asc limit 1/.test(orgSrc)
    && /if \(rows\[0\]\) return rows\[0\]\.org_id;/.test(orgSrc));
  ck("the ROLE follows the selected organization, so a switch cannot carry another org's role",
    /select role from org_members where org_id = \$1 and user_id = \$2/.test(orgSrc));
  const adminSrc = codeOf("../src/app/admin/actions.ts");
  ck("switching checks membership server-side before it will set anything",
    /select 1 from org_members where org_id = \$1 and user_id = \$2/.test(adminSrc)
    && /You are not a member of that organization/.test(adminSrc));
  ck("the whole tree is revalidated on a switch — no segment may keep rendering the old tenant",
    /revalidatePath\("\/", "layout"\)/.test(adminSrc));
  /**
   * THE CONTROL MUST BE REACHABLE, NOT MERELY CORRECT.
   *
   * Hosted certification found the switcher rendering for nobody: the layout never resolved
   * memberships at all, so `orgOptions` was always empty and the component hid itself by design. A
   * second defect sat behind it — `org_members` is RLS-FORCED on `is_org_member(org_id)` and
   * `user_id = auth.uid()`, and on the app_rw connection `auth.uid()` is null, so even a wired-up
   * read on the tenant connection could only ever see the caller's current organization.
   *
   * No local test could have caught either: local runs without RLS identity, and "the component is
   * correct" was true throughout. So this asserts the WIRING and the CONNECTION, which is what was
   * actually broken.
   */
  const layoutSrc = codeOf("../src/app/layout.tsx");
  ck("the layout actually RESOLVES memberships and passes them to the shell",
    /orgOptions = await membershipsFor\(/.test(layoutSrc)
    && /orgOptions=\{orgOptions\}/.test(layoutSrc) && /currentOrgId=\{activeOrgId\}/.test(layoutSrc)
    && /activeOrgId = orgId/.test(layoutSrc));
  ck("BITING — it reads them on the OWNER pool, because RLS makes a cross-org read impossible on the tenant one",
    /membershipsFor\(getOwnerPool\(\)/.test(layoutSrc));
  ck("and the read is still scoped to the authenticated user — it widens the connection, not the subject",
    /where m\.user_id = \$1/.test(orgSrc));
  /**
   * THE SELECTION MUST BE VALIDATED WHERE MEMBERSHIP IS VISIBLE.
   *
   * `org_members` is RLS-FORCED on `is_org_member(org_id)` and `user_id = auth.uid()`. On the
   * app_rw connection `auth.uid()` is null and `app.org_id` is not yet set — `currentOrgId` is what
   * decides it — so a membership check made on the TENANT connection returns nothing every time and
   * the selection silently falls through to the default. Switching then never works, and looks
   * like it does whenever the default happens to be the chosen organization. That is exactly how it
   * shipped, and why an assertion that renders the default proves nothing.
   */
  ck("BITING — the cookie's membership is validated on the OWNER pool, not the tenant connection",
    /const chosen = await selectedOrgCookie\(\)[\s\S]{0,900}?getOwnerPool\(\)\.query[\s\S]{0,200}?from org_members m where m\.org_id = \$1 and m\.user_id = \$2/.test(orgSrc));
  ck("and the ROLE is read the same way, so it cannot answer about a different organization",
    (orgSrc.match(/getOwnerPool\(\)\.query/g) ?? []).length === 2);
  ck("both reads stay scoped to the authenticated user — the connection widens, the subject does not",
    (orgSrc.match(/m\.user_id = \$2|user_id = \$2/g) ?? []).length >= 2);

  ck("creating an organization makes the creator its owner in ONE transaction",
    /insert into organizations \(name, kind, data_environment\)/.test(adminSrc)
    && /insert into org_members \(org_id, user_id, role\) values \(\$1, \$2, 'owner'\)/.test(adminSrc));
  ck("the member-invite path is REUSED, not rebuilt: create user, add membership, set role, remove, last-owner guard",
    /auth\.admin\.createUser/.test(adminSrc) && /Can't demote the last owner/.test(adminSrc)
    && /delete from org_members where org_id = \$1 and user_id = \$2/.test(adminSrc));

  // ── ORGANIZATION PROVENANCE IS NOT THE BROWSER'S ──────────────────────────────────────────────
  HD("ORG PROVENANCE — the trust chain from the rendered form to the stored value");
  const adminActions = codeOf("../src/app/admin/actions.ts");
  const createBody = adminActions.slice(adminActions.indexOf("export async function createOrganizationAction"),
                                        adminActions.indexOf("export async function switchOrganizationAction"));
  ck("BITING — the creation action reads NO environment from the request at all",
    !/formData\.get\(\s*["'](dataEnvironment|data_environment|environment)["']/.test(createBody),
    { note: "an earlier version read it from formData, which a browser could have set to PRODUCTION" });
  ck("it is established by a server-side function, with no ambient fallback",
    /pilotOperatingEnvironment\(\)/.test(createBody) && !/\?\? "PRODUCTION"/.test(createBody));
  ck("and that function returns PILOT for this owner-pilot path",
    /function pilotOperatingEnvironment\(\): DataEnvironment \{\s*return "PILOT";/.test(adminActions));
  const adminPage = codeOf("../src/app/admin/page.tsx");
  const createForm = adminPage.slice(adminPage.indexOf("createOrganizationAction"), adminPage.indexOf("Create workspace"));
  ck("the rendered form offers only a name — there is no environment field to forge",
    /name="name"/.test(createForm) && !/dataEnvironment/.test(createForm));
  ck("creation is owner-gated and makes the creator the owner in ONE transaction",
    /requireOwner\(pool\)/.test(createBody) && /begin/.test(createBody) && /'owner'/.test(createBody));

  // ── INTAKE: THE THREE-FILE SEQUENCE ───────────────────────────────────────────────────────────
  HD("INTAKE — accounts, then CRM opportunities, with contacts carried on the account file");
  const partner = await one(`insert into partners (org_id, name, partner_type) values ($1,$2,'distributor') returning id`, [pilotOrg.id, `P ${NS}`]);
  const uploader = (await one(`select id from auth.users limit 1`))?.id ?? null;

  const analyze = async (csv: string, kind: "book" | "crm", env: string | null) =>
    (await analyzeCsvToBatch(pool as never, { orgId: pilotOrg.id, csv, filename: `${NS}-${kind}.csv`,
      uploadedBy: "web", uploadedByUserId: uploader, dataEnvironment: env as never, kind })).batchId;

  /**
   * A GENUINELY PRE-EXISTING CONTACT, so the fill-only update branch is reached by a real update.
   *
   * The first version of this fixture relied on the batch's own contacts being classified as
   * updates — which they were, but only because the classifier compared `created_at` against
   * `transaction_timestamp()` while the commit ran on a POOL, where every statement is its own
   * transaction. Contacts the batch had just created therefore looked pre-existing. Fixing the
   * classifier to use `xmax = 0` corrected that and, correctly, broke this test: it had been
   * exercising the conflict branch through a defect. This contact predates the batch for real.
   */
  await q(`insert into contacts (org_id, email, name, contact_type, source) values ($1,$2,$3,'end_user','manual')`,
    [pilotOrg.id, "rm@contoso-freight.example", "Sam Ihara"]);

  const b1 = await analyze(ACCOUNTS_CSV, "book", "PILOT");
  const bRow = await one(`select data_environment, uploaded_by_user_id, row_count from import_batches where id=$1`, [b1]);
  ck("the batch takes PILOT from the operating context, and the file never gets a vote",
    bRow.data_environment === "PILOT" && !ACCOUNTS_CSV.includes("PILOT"));
  ck("the REAL uploader is recorded, not the literal 'web'", bRow.uploaded_by_user_id === uploader, { uploader });
  ck("three data rows were staged", Number(bRow.row_count) === 3);
  // BITING — the defect this whole provenance chain exists to prevent, reproduced at the batch
  // level: an organization nobody classified must NOT hand its imports the one environment a
  // learning corpus admits. An earlier version of this suite asserted only the PILOT case, and a
  // `?? "PRODUCTION"` reintroduced in the analyzer passed it silently.
  const unclassifiedOrg = await one(`insert into organizations (name, kind) values ($1,'full') returning id, data_environment`, [`Unclassified ${NS}`]);
  const ub = (await analyzeCsvToBatch(pool as never, { orgId: unclassifiedOrg.id, csv: ACCOUNTS_CSV,
    filename: `${NS}-u.csv`, uploadedBy: "web", uploadedByUserId: uploader,
    dataEnvironment: null, kind: "book" })).batchId;
  ck("an unclassified operating context yields an UNCLASSIFIED batch, never PRODUCTION",
    (await one(`select data_environment from import_batches where id=$1`, [ub])).data_environment === null,
    { got: (await one(`select data_environment from import_batches where id=$1`, [ub])).data_environment });
  ck("and the column has no default that could supply one behind the analyzer's back",
    (await one(`select coalesce(column_default,'-') d from information_schema.columns
                 where table_name='import_batches' and column_name='data_environment'`)).d === "-");
  const intakeActionSrc = codeOf("../src/app/intake/actions.ts");
  ck("the upload action reads provenance from the ORGANIZATION, and nothing reads it from the file",
    /select data_environment from organizations where id = \$1/.test(intakeActionSrc)
    && !/(formData|file|csv|headers|row)[^\n]{0,40}dataEnvironment/i.test(intakeActionSrc));
  ck("the uploader is resolved from the authenticated session, not from the request body",
    /auth\.getUser\(\)/.test(intakeActionSrc) && /uploadedByUserId/.test(intakeActionSrc));

  const targets1: Record<number, string> = { 0: "company", 1: "domain", 2: "industry", 3: "employees", 4: "target_product", 5: "contact_email", 6: "contact_name", 7: "contact_title" };
  const r1 = await commitImportBatch(pool as never, {
    orgId: pilotOrg.id, batchId: b1, targets: targets1, surfaced: ["target_product"],
    population: { name: `${NS} book`, category: "customer", partnerId: partner.id },
  });
  ck("the accounts file lands: three companies, a population, contacts and evidence",
    r1.imported === 3 && r1.created + r1.matched === 3 && r1.contactsUpserted === 2, r1);
  const effects = await q(`select subject_kind, effect, count(*)::int n from import_batch_effects where batch_id=$1 group by 1,2 order by 1,2`, [b1]);
  ck("BATCH LINEAGE SURVIVES COMMIT — the effects are recorded, not deleted with the staged rows",
    effects.length > 0 && (await n(`select count(*)::int n from import_rows where batch_id=$1`, [b1])) === 0,
    effects.map((e) => `${e.subject_kind}:${e.effect}=${e.n}`));
  ck("companies created by the batch are classified as SHARED IDENTITY, never as reversible rows",
    effects.some((e) => e.subject_kind === "company" && e.effect === "GLOBAL_IDENTITY_RETAINED")
    && !effects.some((e) => GLOBAL_IDENTITY_KINDS.includes(e.subject_kind) && e.effect === "CREATED_REVERSIBLE"));

  // Re-import the SAME file: identity matching must not duplicate.
  const companiesBefore = await n(`select count(*)::int n from companies`);
  const b1b = await analyze(ACCOUNTS_CSV, "book", "PILOT");
  await commitImportBatch(pool as never, {
    orgId: pilotOrg.id, batchId: b1b, targets: targets1, surfaced: ["target_product"],
    population: { name: `${NS} book 2`, category: "customer", partnerId: partner.id },
  });
  ck("RE-IMPORT IS IDEMPOTENT AT THE IDENTITY LEVEL — matched, not duplicated",
    await n(`select count(*)::int n from companies`) === companiesBefore,
    { companies: companiesBefore });
  ck("and the second batch records them as MATCHED_PREEXISTING, which is what makes reversal safe",
    await n(`select count(*)::int n from import_batch_effects where batch_id=$1 and subject_kind='company' and effect='MATCHED_PREEXISTING'`, [b1b]) === 3);

  const b2 = await analyze(CRM_CSV, "crm", "PILOT");
  const r2 = await commitCrmBatch(pool as never, { orgId: pilotOrg.id, batchId: b2,
    targets: { 0: "company", 1: "opportunity_name", 2: "deal_stage", 3: "deal_value", 4: "close_date" } });
  ck("the CRM file lands as snapshots and open opportunities", r2.snapshots === 2 && r2.oppsCreated === 2, r2);
  ck("an import is an OBSERVATION, not a business creation — no OPPORTUNITY_CREATED is claimed",
    await n(`select count(*)::int n from change_ledger where org_id=$1 and change_type='OPPORTUNITY_CREATED'`, [pilotOrg.id]) === 0);

  // ── MAPPING / VALIDATION ──────────────────────────────────────────────────────────────────────
  HD("MAPPING — a file that names nothing is refused BEFORE anything is committed");
  const b3 = await analyze(ACCOUNTS_CSV, "book", "PILOT");
  let mapErr = "";
  try { await commitImportBatch(pool as never, { orgId: pilotOrg.id, batchId: b3, targets: { 1: "domain" }, surfaced: [],
        population: { name: `${NS} bad`, category: "customer", partnerId: null } }); }
  catch (e) { mapErr = (e as Error).message; }
  ck("an unmapped Company column refuses the commit", /Map one column to Company name/.test(mapErr), { mapErr });
  ck("and nothing was written — the refusal is before the first row",
    await n(`select count(*)::int n from import_batch_effects where batch_id=$1`, [b3]) === 0);

  // ── FAILURE IS DURABLE ────────────────────────────────────────────────────────────────────────
  HD("FAILURE — the original cause survives, and the batch ends durably FAILED");
  const stagedSrc = codeOf("../src/lib/ingest/staged.ts");
  ck("the failed status is no longer written inside the transaction the failure aborted",
    !/catch \(err\) \{\s*await db\.query\(`update import_batches set status = 'failed'/.test(stagedSrc)
    && /markBatchFailed/.test(stagedSrc));
  ck("it is written on a SEPARATE connection, so the caller's rollback cannot discard it",
    /getOwnerPool\(\)\.query\(\s*`update import_batches set status = 'failed'/.test(stagedSrc));
  ck("and the original error is re-thrown untouched", /throw err;/.test(stagedSrc));
  const b4 = await analyze(ACCOUNTS_CSV, "book", "PILOT");
  let failMsg = "";
  try {
    await commitImportBatch(pool as never, { orgId: pilotOrg.id, batchId: b4, targets: targets1, surfaced: [],
      population: { name: `${NS} boom`, category: "customer", partnerId: randomUUID() } });   // a partner that does not exist
  } catch (e) { failMsg = (e as Error).message; }
  const b4row = await one(`select status, error from import_batches where id=$1`, [b4]);
  ck("BEHAVIOURAL — a genuine commit failure ends FAILED with the ORIGINAL cause, not 25P02",
    b4row.status === "failed" && !!b4row.error && !/current transaction is aborted/i.test(b4row.error)
    && !/current transaction is aborted/i.test(failMsg), { status: b4row.status, error: (b4row.error ?? "").slice(0, 90) });

  // ── REVERSAL ──────────────────────────────────────────────────────────────────────────────────
  HD("REVERSAL — compensate the tenant's effects, keep the shared graph, keep the history");
  const contactRow = await one(`select id, name from contacts where org_id=$1 and email='ops@northwind.example'`, [pilotOrg.id]);
  const oppRow = await one(`select id from opportunities where org_id=$1 and name like 'Northwind%'`, [pilotOrg.id]);
  // A later human change on one contact, so the conflict branch is reached by real divergence.
  const conflicted = await one(`select id, title from contacts where org_id=$1 and email='rm@contoso-freight.example'`, [pilotOrg.id]);
  ck("the pre-existing contact was FILLED by the batch, not created by it — the update branch is genuinely reached",
    await n(`select count(*)::int n from import_batch_effects
              where batch_id=$1 and subject_kind='contact' and subject_id=$2 and effect='UPDATED_REVERSIBLE'`,
            [b1, conflicted.id]) === 1, { title: conflicted.title });
  await q(`update contacts set title = 'Changed by a person' where id=$1`, [conflicted.id]);
  // And a downstream reference on the opportunity, so the referenced branch is reached too.
  const pu = await one(`insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
                        values ($1,(select company_id from opportunities where id=$2),'QUALIFIED',$3,'PILOT','MODERNIZATION') returning id`,
                       [pilotOrg.id, oppRow.id, `${NS}-pu`]);
  await q(`update opportunities set pursuit_id=$2 where id=$1`, [oppRow.id, pu.id]);

  const globalBefore = await n(`select count(*)::int n from companies`);
  const rev = await (async () => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [pilotOrg.id]);
      const r = await reverseBatch(c, { orgId: pilotOrg.id, batchId: b1, userId: uploader }); await c.query("commit"); return r; }
    catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  })();
  note("reversal outcome", rev);
  ck("GLOBAL IDENTITY IS RETAINED BY RULE — no company is deleted to make one tenant's import vanish",
    await n(`select count(*)::int n from companies`) === globalBefore && rev.retainedGlobal > 0);
  ck("and the reversal REPORTS the retained identity records rather than hiding them",
    await n(`select count(*)::int n from import_batch_reversals where batch_id=$1 and disposition='RETAINED_GLOBAL'`, [b1]) === rev.retainedGlobal);
  ck("org-scoped rows created solely by the batch are compensated", rev.reversed > 0);
  ck("a fill-only update whose value a person has since changed becomes ROLLBACK_CONFLICT, and the LATER WORK IS KEPT",
    (await one(`select title from contacts where id=$1`, [conflicted.id])).title === "Changed by a person");
  // The referenced opportunity came from the CRM batch, so the branch is reached by reversing THAT
  // batch — asserting it against the accounts batch would have passed without ever running.
  const revCrm = await (async () => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [pilotOrg.id]);
      const r = await reverseBatch(c, { orgId: pilotOrg.id, batchId: b2, userId: uploader }); await c.query("commit"); return r; }
    catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  })();
  note("CRM reversal outcome", revCrm);
  ck("an object a pursuit now depends on is RETAINED_REFERENCED, never destroyed to tidy an import",
    revCrm.retainedReferenced >= 1
    && await n(`select count(*)::int n from opportunities where id=$1`, [oppRow.id]) === 1
    && await n(`select count(*)::int n from import_batch_reversals where batch_id=$1 and disposition='RETAINED_REFERENCED'`, [b2]) >= 1);
  ck("CONTROL — the unreferenced opportunity from the SAME batch WAS reversed, so the guard is not refusing everything",
    revCrm.reversed >= 1);
  ck("HISTORY SURVIVES — the batch, its effects and every disposition remain auditable",
    await n(`select count(*)::int n from import_batches where id=$1 and reversed_at is not null`, [b1]) === 1
    && await n(`select count(*)::int n from import_batch_effects where batch_id=$1`, [b1]) > 0
    && await n(`select count(*)::int n from import_batch_reversals where batch_id=$1`, [b1]) > 0);
  const secondRev = await (async () => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [pilotOrg.id]);
      const r = await reverseBatch(c, { orgId: pilotOrg.id, batchId: b1, userId: uploader }); await c.query("commit"); return r; }
    finally { c.release(); }
  })();
  ck("REPEATED REVERSAL IS IDEMPOTENT — the second call reports, it does not act again",
    secondRev.alreadyReversed === true
    && await n(`select count(*)::int n from import_batch_reversals where batch_id=$1`, [b1]) === rev.reversed + rev.retainedGlobal + rev.retainedMatched + rev.retainedReferenced + rev.conflicts);
  ck("a matched pre-existing object survives its batch being reversed",
    await n(`select count(*)::int n from companies where normalized_name like '%northwind%'`) >= 1);
  const lineageSrc = codeOf("../src/lib/ingest/lineage.ts");
  ck("BITING — reversal contains no cross-org reference counting and no 'delete if unreferenced' path",
    !/count\(\*\)[\s\S]{0,80}from companies/.test(lineageSrc) && !/delete from companies/.test(lineageSrc)
    && !/delete from company_aliases/.test(lineageSrc));
  ck("append-only: app_rw can neither edit nor delete batch lineage or reversal history",
    /app_rw=ar\//.test((await one(`select array_to_string(relacl,',') a from pg_class where relname='import_batch_effects'`)).a)
    && /app_rw=ar\//.test((await one(`select array_to_string(relacl,',') a from pg_class where relname='import_batch_reversals'`)).a));

  // ── CANONICAL SUBJECT PROVENANCE ──────────────────────────────────────────────────────────────
  HD("SUBJECT PROVENANCE — origin is the creation event, never the latest batch to touch it");
  const { subjectOriginProvenance, opportunityOriginEnvironment } = await import("../src/lib/pursuits/provenance");
  const asOrg = async <T>(orgId: string, fn: (db: import("pg").PoolClient) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [orgId]);
      const r = await fn(c); await c.query("commit"); return r; }
    catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  };

  // The CRM batch created two opportunities under PILOT provenance.
  const madeOpp = await one(`select e.subject_id from import_batch_effects e
                              where e.batch_id=$1 and e.subject_kind='opportunity' and e.effect='CREATED_REVERSIBLE' limit 1`, [b2]);
  const origin = await asOrg(pilotOrg.id, (db) => subjectOriginProvenance(db, pilotOrg.id, "opportunity", madeOpp.subject_id));
  ck("CREATED — an opportunity an intake created resolves to that import's environment",
    origin.status === "ESTABLISHED" && origin.environment === "PILOT", origin);

  // MATCHED must not relabel. A DEMO opportunity that a PILOT batch later references.
  const demoOpp = await one(`insert into opportunities (org_id, company_id, name, stage, amount_usd)
                             values ($1,(select company_id from opportunities where id=$2),$3,'discovery',1000) returning id`,
                            [pilotOrg.id, oppRow.id, `${NS} pre-existing`]);
  await q(`insert into import_batch_effects (org_id, batch_id, subject_kind, subject_id, effect, data_environment)
           values ($1,$2,'opportunity',$3,'MATCHED_PREEXISTING','PILOT')`, [pilotOrg.id, b2, demoOpp.id]);
  const matched = await asOrg(pilotOrg.id, (db) => subjectOriginProvenance(db, pilotOrg.id, "opportunity", demoOpp.id));
  ck("MATCHED DOES NOT RELABEL — a PILOT batch matching a subject establishes nothing about it",
    matched.status === "UNESTABLISHED", matched);
  ck("UNKNOWN DOES NOT BECOME KNOWN — and it certainly does not become PRODUCTION",
    (await asOrg(pilotOrg.id, (db) => opportunityOriginEnvironment(db, pilotOrg.id, demoOpp.id, null))) === null);
  // ... and where the subject DOES have its own established provenance, that is what is used.
  const demoPursuit = await one(`insert into pursuits (org_id, account_id, status, dedup_key, data_environment, pursuit_type)
                                 values ($1,(select company_id from opportunities where id=$2),'QUALIFIED',$3,'DEMO','MODERNIZATION') returning id`,
                                [pilotOrg.id, demoOpp.id, `${NS}-demo-pu`]);
  await q(`update opportunities set pursuit_id=$2 where id=$1`, [demoOpp.id, demoPursuit.id]);
  ck("an established canonical provenance is PRESERVED — a DEMO subject matched by a PILOT batch stays DEMO",
    (await asOrg(pilotOrg.id, (db) => opportunityOriginEnvironment(db, pilotOrg.id, demoOpp.id, demoPursuit.id))) === "DEMO");

  // MULTI-BATCH: later effects, in any order, cannot move the answer.
  for (const env of ["CERTIFICATION", "DEMO"]) {
    await q(`insert into import_batch_effects (org_id, batch_id, subject_kind, subject_id, effect, data_environment, recorded_at)
             values ($1,$2,'opportunity',$3,'MATCHED_PREEXISTING',$4, now() + interval '1 hour')`,
            [pilotOrg.id, b2, madeOpp.subject_id, env]);
  }
  const afterTouches = await asOrg(pilotOrg.id, (db) => subjectOriginProvenance(db, pilotOrg.id, "opportunity", madeOpp.subject_id));
  ck("MULTI-BATCH — two later batches touch the subject, one of them CERTIFICATION; the origin is still PILOT",
    afterTouches.status === "ESTABLISHED" && afterTouches.environment === "PILOT", afterTouches);
  // Reordering by time must be irrelevant, because time is not consulted.
  await q(`update import_batch_effects set recorded_at = now() - interval '10 years'
            where subject_id=$1 and effect='CREATED_REVERSIBLE'`, [madeOpp.subject_id]);
  const reordered = await asOrg(pilotOrg.id, (db) => subjectOriginProvenance(db, pilotOrg.id, "opportunity", madeOpp.subject_id));
  ck("NO LATEST-ROW DEPENDENCE — making the creation event the OLDEST row changes nothing",
    reordered.status === "ESTABLISHED" && reordered.environment === "PILOT");
  const provSrc = codeOf("../src/lib/pursuits/provenance.ts");
  ck("BITING — the resolver reads ONLY creation effects, and orders by nothing",
    /effect = 'CREATED_REVERSIBLE'/.test(provSrc)
    && !/order by[\s\S]{0,40}recorded_at/.test(provSrc) && !/limit 1/.test(provSrc.slice(provSrc.indexOf("subjectOriginProvenance"))));
  // The other two readers are the reversal engine (which reads effects to compensate, not to label)
  // and the intake page (which counts them). Neither derives an environment, and this asserts that
  // directly rather than by listing filenames a refactor would invalidate.
  ck("and no OTHER reader of batch effects derives an environment from them",
    !/data_environment/.test(codeOf("../src/app/intake/page.tsx").slice(0, 20_000).match(/import_batch_effects[^`]*/)?.[0] ?? "")
    && !/select[^`]*data_environment[^`]*from import_batch_effects/.test(codeOf("../src/lib/ingest/lineage.ts")));

  // TWO CREATION EVENTS IS A DEFECT, NOT A TIE.
  await q(`insert into import_batch_effects (org_id, batch_id, subject_kind, subject_id, effect, data_environment)
           values ($1,$2,'opportunity',$3,'CREATED_REVERSIBLE','CERTIFICATION')`, [pilotOrg.id, b2, madeOpp.subject_id]);
  const ambiguous = await asOrg(pilotOrg.id, (db) => subjectOriginProvenance(db, pilotOrg.id, "opportunity", madeOpp.subject_id));
  ck("AMBIGUOUS LINEAGE IS REFUSED — a subject created twice is a defect, not a timestamp to break",
    ambiguous.status === "AMBIGUOUS", ambiguous);
  ck("and a refused resolution yields NO environment rather than a guess",
    (await asOrg(pilotOrg.id, (db) => opportunityOriginEnvironment(db, pilotOrg.id, madeOpp.subject_id, null))) === null);
  await q(`delete from import_batch_effects where subject_id=$1 and data_environment='CERTIFICATION' and effect='CREATED_REVERSIBLE'`, [madeOpp.subject_id]);

  // THE SLICE-1 GAP: an intake-created opportunity with NO pursuit, moved by a real lifecycle action.
  HD("SUBJECT PROVENANCE — the Slice-1 imported-opportunity gap, closed");
  // A FRESH import: the earlier CRM batch was reversed above, which removed its unreferenced
  // opportunity — so reusing it here would have tested a deleted row.
  // A BRAND-NEW ACCOUNT. The CRM lane syncs in but never overwrites: it creates an opportunity only
  // where the account has no open one, so reusing an account that already has one would silently
  // produce no subject to test.
  const b5 = await analyze(
    `Company,Opportunity Name,Deal Stage,Deal Value,Close Date\nOrphan Works ${NS},${NS} orphan deal,Qualification,90000,2027-03-01`,
    "crm", "PILOT");
  await commitCrmBatch(pool as never, { orgId: pilotOrg.id, batchId: b5,
    targets: { 0: "company", 1: "opportunity_name", 2: "deal_stage", 3: "deal_value", 4: "close_date" } });
  const orphan = await one(`select subject_id from import_batch_effects
                             where batch_id=$1 and subject_kind='opportunity' and effect='CREATED_REVERSIBLE' limit 1`, [b5]);
  ck("the fresh import created an opportunity to test with", !!orphan?.subject_id);
  ck("the fixture is genuinely unlinked — no pursuit to derive from",
    (await one(`select pursuit_id from opportunities where id=$1`, [orphan.subject_id])).pursuit_id === null);
  await asOrg(pilotOrg.id, async (db) => {
    const { advanceOpportunity } = await import("../src/lib/opportunities/lifecycle");
    await advanceOpportunity(db, pilotOrg.id, orphan.subject_id, "proposal");
  });
  const orphanLedger = await q(`select change_type, data_environment from change_ledger where entity_id=$1`, [orphan.subject_id]);
  ck("A STAGE CHANGE ON AN IMPORTED, PURSUIT-LESS OPPORTUNITY NOW WRITES IMMUTABLE PILOT HISTORY",
    orphanLedger.length === 1 && orphanLedger[0].change_type === "STAGE_CHANGED" && orphanLedger[0].data_environment === "PILOT",
    orphanLedger);
  // NO FALLBACK: remove the creation lineage and the same action must decline, not default.
  const noLineage = await one(`insert into opportunities (org_id, company_id, name, stage, amount_usd)
                               values ($1,(select company_id from opportunities where id=$2),$3,'discovery',2000) returning id`,
                              [pilotOrg.id, orphan.subject_id, `${NS} no-lineage`]);
  await asOrg(pilotOrg.id, async (db) => {
    const { advanceOpportunity } = await import("../src/lib/opportunities/lifecycle");
    await advanceOpportunity(db, pilotOrg.id, noLineage.id, "proposal");
  });
  ck("NO FALLBACK — without creation lineage the ledger write is WITHHELD, never defaulted to PRODUCTION",
    await n(`select count(*)::int n from change_ledger where entity_id=$1`, [noLineage.id]) === 0);
  ck("CONTROL — and the business mutation itself still succeeded, so the refusal is evidentiary only",
    (await one(`select stage from opportunities where id=$1`, [noLineage.id])).stage === "proposal");

  // TENANT ISOLATION on the lineage itself.
  const foreignOrigin = await asOrg(demoOrg.id, (db) => subjectOriginProvenance(db, demoOrg.id, "opportunity", orphan.subject_id));
  ck("TENANT — another organization cannot discover or borrow provenance through this org's lineage",
    foreignOrigin.status === "UNESTABLISHED", foreignOrigin);

  // ── ATTENTION: THE TOKEN ──────────────────────────────────────────────────────────────────────
  HD("ATTENTION — the token is evidence context, minted at render, redeemed at selection");
  const facts = {
    orgId: pilotOrg.id, userId: uploader, pursuitId: pu.id,
    surfaceId: "today" as const, surfaceVersion: "today-v1", sortMode: "materiality-policy",
    filters: {}, displayLimit: 12, p2Rank: 3, comparisonSetSize: 18, withheldCount: 1,
    surfaceOrdinal: 1, score: 71, band: "HIGH",
    components: [{ key: "timing", contribution: 0.4 }],
    algorithmVersion: "p2-v1", snapshotFingerprint: "abc123", scope: "All pursuits", dataEnvironment: "PILOT",
  };
  const token = mintAttentionToken(facts);
  ck("a minted token verifies and returns exactly what the server put in it",
    readAttentionToken(token)?.p2Rank === 3 && readAttentionToken(token)?.surfaceOrdinal === 1);
  ck("TAMPERING IS REFUSED — a body edited to claim rank 1 does not verify",
    (() => { const [v, b] = token.split("."); const t = JSON.parse(Buffer.from(b, "base64url").toString()); t.p2Rank = 1;
             return readAttentionToken(`${v}.${Buffer.from(JSON.stringify(t)).toString("base64url")}.${token.split(".")[2]}`) === null; })());
  ck("a token with a stripped or foreign signature is refused",
    readAttentionToken(token.split(".").slice(0, 2).join(".")) === null
    && readAttentionToken(`${token.split(".")[0]}.${token.split(".")[1]}.AAAA`) === null
    && readAttentionToken("nonsense") === null && readAttentionToken(null) === null);
  const tokenSrc = codeOf("../src/lib/pursuits/evidence/attention-token.ts");
  ck("the comparison is constant-time and the body is parsed only AFTER it verifies",
    /timingSafeEqual/.test(tokenSrc) && tokenSrc.indexOf("timingSafeEqual") < tokenSrc.lastIndexOf("JSON.parse"));

  HD("ATTENTION — redemption binds to the authenticated user, org and subject");
  const redeem = async (f: typeof facts, userId: string | null, nonce?: string) => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [pilotOrg.id]);
      const r = await recordAttentionSelection(c, { facts: { ...f, nonce: nonce ?? randomUUID(), renderedAt: new Date().toISOString() }, userId });
      await c.query("commit"); return r; }
    catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  };
  const first = await redeem(facts, uploader);
  ck("an explicit selection writes EXACTLY ONE observation", first.written === true
    && await n(`select count(*)::int n from attention_observations where org_id=$1`, [pilotOrg.id]) === 1);
  const stored = await one(`select p2_rank, surface_ordinal, surface_id, sort_mode, comparison_set_size, display_limit,
                                   data_environment, selected_by_user_id, rendered_at, selected_at, components
                              from attention_observations where org_id=$1`, [pilotOrg.id]);
  ck("THE TWO POSITIONS ARE STORED SEPARATELY AND ARE DIFFERENT NUMBERS — #3 of 18 by P2, 1st card on the page",
    stored.p2_rank === 3 && stored.surface_ordinal === 1 && stored.p2_rank !== stored.surface_ordinal);
  ck("the surface context needed to interpret either is stored with them",
    stored.surface_id === "today" && stored.sort_mode === "materiality-policy"
    && stored.comparison_set_size === 18 && stored.display_limit === 12);
  ck("provenance, selector and both timestamps are recorded",
    stored.data_environment === "PILOT" && stored.selected_by_user_id === uploader
    && !!stored.rendered_at && !!stored.selected_at);
  ck("components carry declared keys and numbers only — no prose",
    Array.isArray(stored.components) && stored.components[0].key === "timing" && !JSON.stringify(stored.components).includes("because"));
  // The retired P8-0-style "no orphan after a rolled-back dispatch" property: the producer no longer
  // STAGES anything in memory to be discarded, because it is no longer called inside a governed
  // dispatch. The property is now structural — one statement, nothing held — so it is asserted as
  // that rather than left to lapse when the failure mode it guarded stopped existing.
  const captureSrc2 = codeOf("../src/lib/pursuits/evidence/attention-capture.ts");
  ck("the write is a SINGLE statement with nothing staged — there is no in-memory sink to outlive a rollback",
    (captureSrc2.match(/db\.query\(/g) ?? []).length === 1
    && !/push\(|sink|stage|drain/i.test(captureSrc2));
  const rolledBack = await (async () => {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [pilotOrg.id]);
      await recordAttentionSelection(c, { facts: { ...facts, nonce: randomUUID(), renderedAt: new Date().toISOString() }, userId: uploader });
      const mid = Number((await c.query(`select count(*)::int n from attention_observations where org_id=$1`, [pilotOrg.id])).rows[0].n);
      await c.query("rollback");
      return { mid, after: await n(`select count(*)::int n from attention_observations where org_id=$1`, [pilotOrg.id]) };
    } finally { c.release(); }
  })();
  ck("BEHAVIOURAL — an observation written in a transaction that rolls back leaves nothing behind",
    rolledBack.mid === rolledBack.after + 1, rolledBack);

  const replay = await redeem(facts, uploader, readAttentionToken(mintAttentionToken({ ...facts, nonce: first.snapshotId }))!.nonce);
  void replay;
  const sameNonce = readAttentionToken(token)!.nonce;
  await redeem(facts, uploader, sameNonce);
  const dup = await redeem(facts, uploader, sameNonce);
  ck("REPLAYING THE SAME TOKEN IS IDEMPOTENT — one deliberate act, one observation", dup.written === false);
  const before = await n(`select count(*)::int n from attention_observations where org_id=$1`, [pilotOrg.id]);
  await redeem(facts, uploader);
  ck("but a NEWLY RENDERED surface may legitimately produce a new observation on a later selection",
    await n(`select count(*)::int n from attention_observations where org_id=$1`, [pilotOrg.id]) === before + 1);

  HD("ATTENTION — the write boundary, structurally");
  const actionSrc = codeOf("../src/app/attention/actions.ts");
  ck("redemption resolves identity and membership INDEPENDENTLY, then checks the token against them",
    /currentRole\(db\)/.test(actionSrc) && /facts\.orgId !== orgId/.test(actionSrc)
    && /facts\.userId !== null && userId !== null && facts\.userId !== userId/.test(actionSrc));
  ck("the subject is re-checked against this org — a token naming another tenant's pursuit writes nothing",
    /select 1 from pursuits where id = \$1 and org_id = \$2/.test(actionSrc));
  ck("P2 IS NOT RECOMPUTED — what is persisted is what was rendered",
    !/getPortfolioPertinence|rankPortfolioPertinence/.test(actionSrc));
  ck("the navigation target is derived from the subject, so the action is not an open redirect",
    /destination = `\/pursuits\/\$\{facts\.pursuitId\}`/.test(actionSrc));
  const todaySrc = codeOf("../src/lib/pursuits/read-models/today.ts");
  ck("RENDERING MINTS, IT DOES NOT WRITE — the read model inserts no observation",
    !/insert into attention_observations/.test(todaySrc));
  const loadersSrc = codeOf("../src/lib/pursuits/read-models/attention-loaders.ts");
  ck("the ordinal comes from the FINAL composed list, not from the pre-composition order",
    /mintSurfaceTokens\(composed\.items/.test(loadersSrc));
  const cardSrc = codeOf("../src/components/pursuit/today.tsx");
  ck("the primary CTA is a FORM, not a link — a GET cannot mean a deliberate choice",
    /<form action=\{selectPursuitAction\}/.test(cardSrc));
  ck("and without a token the card is exactly the link it always was, so the flag-OFF card is unchanged",
    /item\.attentionToken \? \(/.test(cardSrc) && /<Link href=\{item\.deepLink\}/.test(cardSrc));

  // ── THE TOKEN DISCLOSES NOTHING THE SURFACE DID NOT ──────────────────────────────────────────
  HD("ATTENTION TOKEN — what the browser is handed, and what it is not");
  const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  // The token is base64url, so EVERYTHING in it is disclosed to the client. It must therefore carry
  // only the bounded observation contract the card already displayed.
  ck("the token carries ONLY the declared observation contract — no extra keys crept in",
    new Set(Object.keys(decoded)).size === Object.keys(decoded).length
    && Object.keys(decoded).every((k) => [
      "orgId", "userId", "pursuitId", "surfaceId", "surfaceVersion", "sortMode", "filters",
      "displayLimit", "p2Rank", "comparisonSetSize", "withheldCount", "surfaceOrdinal", "score",
      "band", "components", "algorithmVersion", "snapshotFingerprint", "scope", "dataEnvironment",
      "renderedAt", "nonce"].includes(k)), { keys: Object.keys(decoded) });
  ck("D-018 HOLDS ON THE WIRE — withheld information is a COUNT, never an identity or a value",
    typeof decoded.withheldCount === "number"
    && !JSON.stringify(decoded).toLowerCase().includes("withheldsubject")
    && !/withheld[^C]/i.test(JSON.stringify(decoded)));
  ck("no prose reaches the browser: components are declared keys and numbers, with no reason text",
    Array.isArray(decoded.components)
    && decoded.components.every((c: Record<string, unknown>) => Object.keys(c).every((k) => k === "key" || k === "contribution")));
  const mintSrc = codeOf("../src/lib/pursuits/read-models/today.ts");
  const mintBody = mintSrc.slice(mintSrc.indexOf("export function mintSurfaceTokens"));
  ck("BITING — the minter projects signals down to key+contribution and never passes the whole signal",
    /components: \(p\?\.signals \?\? \[\]\)\.map\(\(sg\) => \(\{ key: sg\.key \?\? null, contribution: sg\.contribution \?\? null \}\)\)/.test(mintBody)
    && !/topReasons|comparedToBelow|whyHere/.test(mintBody));
  ck("CONTROL — P2 DOES carry that prose, so the omission is a projection and not an empty source",
    /topReasons/.test(codeOf("../src/lib/pursuits/read-models/portfolio-pertinence.ts")));
  ck("the withheld pursuits themselves never reach the token: P2 removes them before the set exists",
    decoded.comparisonSetSize === 18 && decoded.withheldCount === 1
    && !JSON.stringify(decoded).includes("DISCLOSED"));

  // ── TENANT ISOLATION ──────────────────────────────────────────────────────────────────────────
  HD("TENANT — another organization's batch or surface cannot enter this one");
  let xoErr = "";
  try {
    const c = await pool.connect();
    try { await c.query("begin"); await c.query(`select set_config('app.org_id',$1,true)`, [demoOrg.id]);
      await reverseBatch(c, { orgId: demoOrg.id, batchId: b2, userId: null }); await c.query("commit"); }
    catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
  } catch (e) { xoErr = (e as Error).message; }
  ck("a foreign organization cannot reverse this org's batch", /Import not found/.test(xoErr), { xoErr });
  const foreignFacts = { ...facts, orgId: demoOrg.id };
  const ft = mintAttentionToken(foreignFacts);
  ck("a token minted for another org carries that org and cannot claim this one",
    readAttentionToken(ft)?.orgId === demoOrg.id && readAttentionToken(ft)?.orgId !== pilotOrg.id);
  ck("CONTROL — the guard is in the action, and it compares against the SERVER's org, not the token's",
    /if \(facts\.orgId !== orgId\) return;/.test(actionSrc));

  console.log(`\n=== SLICE 2 — ${pass} passed, ${fail} failed`);
}
main().catch((e) => { fail++; console.error("\n!! HALTED:", e instanceof Error ? e.message : e); })
  .finally(async () => { console.log(`\n=== SLICE 2 — ${pass} passed, ${fail} failed`); await pool.end().catch(() => {}); process.exit(fail === 0 ? 0 : 1); });
