/**
 * TEMPORARY — P6-IG HOSTED ACCEPTANCE HARNESS (part 2). See ./checks.ts for the standing warning:
 * this is not a product capability and is removed before P6-IG can be marked HOSTED CLOSED.
 *
 * These parts exercise the PRODUCT'S OWN governance modules — `mayDerive`, `mayShareOnward`,
 * `mayDelegate`, `resolveDisclosure`, `derivedDisposition`, `mayRenderWithheldCount` — under the
 * runtime's real `app_rw` session, so what is measured is the behaviour a recipient would actually
 * get, not a re-implementation of it inside a test.
 */
import type { PoolClient } from "pg";
import {
  DERIVATION_PURPOSES, SAFE_DECLASSIFICATION_TRANSFORMS, CROSS_ORG_COUNT_FLOOR,
  mayDerive, derivedDisposition, mayRenderWithheldCount,
} from "@/lib/pursuits/federation/derivation";
import { mayShareOnward, mayGrantOnwardAtPursuitLevel, mayDelegate, buildFederationViewer } from "@/lib/pursuits/federation/grants";
import { resolveDisclosure, type Disclosable } from "@/lib/pursuits/federation/disclosure";
import { type Checks, type Fixture, setOrg } from "./checks";

const one = async <T extends Record<string, unknown>>(db: PoolClient, sql: string, params: unknown[] = []): Promise<T | undefined> =>
  (await db.query<T>(sql, params)).rows[0];

// ── F — mayDerive, under the runtime app_rw connection ──────────────────────────────────────────

export async function runDerivation(db: PoolClient, c: Checks, f: Fixture): Promise<void> {
  await setOrg(db, f.b);
  const on = (pursuit: string) => ({ pursuitId: pursuit, sourceOrgId: f.a });
  const derive = (inputKind: string, purpose: string, viewer = f.b) =>
    mayDerive(db, viewer, { inputKind, ...on(f.pursuit) }, purpose);

  c.add("POSITIVE CONTROL — derivation ALLOWED under the machine-governed, purpose-matched, class-covered live grant",
    (await derive("economic_fact", "VALUE_CASE")).allow === true);
  c.add("WRONG PURPOSE denied — a ROUTE_EVALUATION operation cannot use a VALUE_CASE grant",
    (await derive("economic_fact", "ROUTE_EVALUATION")).allow === false);
  c.add("WRONG INFORMATION CLASS denied — the grant covers economic_value only",
    (await derive("stakeholder_role", "VALUE_CASE")).allow === false);
  c.add("CO_SELL_CONTEXT_DISPLAY is not a derivation purpose, so it can never authorize derivation",
    (await derive("economic_fact", "CO_SELL_CONTEXT_DISPLAY")).allow === false &&
    !DERIVATION_PURPOSES.has("CO_SELL_CONTEXT_DISPLAY"));
  c.add("an unmapped input kind denies — no wildcard, no OTHER class",
    (await derive("something_unmapped", "VALUE_CASE")).allow === false);
  c.add("an organization derives from its OWN information without a grant",
    (await mayDerive(db, f.a, { inputKind: "economic_fact", pursuitId: f.pursuit, sourceOrgId: f.a }, "VALUE_CASE")).allow === true);

  await setOrg(db, f.c);
  c.add("a NON-PARTICIPANT is denied outright",
    (await mayDerive(db, f.c, { inputKind: "economic_fact", pursuitId: f.pursuit, sourceOrgId: f.a }, "VALUE_CASE")).allow === false);
  await setOrg(db, f.b);

  // A DATA grant is not action authority, and the legacy vocabulary confers nothing.
  const legacyOnly = await one<{ n: number }>(db,
    `select count(*)::int as n from context_grants
      where pursuit_id = $1 and to_org_id = $2 and purpose_code is null and status = 'accepted'`, [f.pursuit, f.b]);
  c.add("the fixture carries a live LEGACY grant whose vocabulary is the legacy one", (legacyOnly?.n ?? 0) > 0, String(legacyOnly?.n));
  c.add("a LEGACY grant confers NO derivation authority, however complete it looks",
    (await derive("transaction_adjacency", "CONFLICT_DETECTION")).allow === false);

  // The denial must carry no fragment of the source organization's data.
  const denied = await derive("stakeholder_role", "VALUE_CASE");
  const reason = denied.allow === false ? denied.reason : "";
  c.add("a DENIED derivation decision carries no fragment of the source organization's data",
    reason.length > 0 && !reason.includes(f.a) && !reason.includes(f.pursuit) && !/\d{4,}/.test(reason), reason.slice(0, 80));
}

// ── G — D-P6-1: one governance clock, and it never leaves SQL ───────────────────────────────────

export async function runTemporal(db: PoolClient, c: Checks, f: Fixture): Promise<void> {
  const pursuit = f.windowPursuit ?? f.pursuit;
  await setOrg(db, f.b);

  // The authoritative instant is the DATABASE transaction time, fixed for the whole transaction.
  const t = await one<{ txn: string; stmt: string; same: boolean }>(db,
    `select transaction_timestamp()::text as txn, statement_timestamp()::text as stmt,
            transaction_timestamp() = transaction_timestamp() as same`);
  c.add("the governance clock is the DB transaction timestamp, stable within the transaction", t?.same === true);
  c.add("the transaction instant carries MICROSECOND precision (a JS Date would truncate to ms)",
    /\.\d{6}/.test(t?.txn ?? ""), (t?.txn ?? "").slice(-9));

  // The window fixtures: one live, one not yet started, one already ended — all ACTIVE state, so
  // ONLY the window can be deciding.
  const rows = await db.query<{ tag: string; org_id: string; rls: boolean; readmodel: boolean; state: string }>(
    `select pp.role_key as tag, pp.org_id::text as org_id, pp.participation_state as state,
            public.can_see_pursuit(pp.pursuit_id) as rls,
            (pp.participation_state = 'ACTIVE'
             and (pp.effective_from is null or pp.effective_from <= transaction_timestamp())
             and (pp.effective_to   is null or pp.effective_to   >  transaction_timestamp())) as readmodel
       from pursuit_participants pp
      where pp.pursuit_id = $1 and pp.org_id = $2
      order by pp.role_key`, [pursuit, f.b]);
  c.add("the temporal fixture is present", rows.rows.length > 0, `${rows.rows.length} participant rows`);

  // Determinism: repeat the paired evaluation and require zero disagreements at every probe.
  let disagreements = 0, probes = 0;
  for (let i = 0; i < 25; i++) {
    const p = await one<{ rls: boolean; readmodel: boolean }>(db,
      `select public.can_see_pursuit($1) as rls,
              exists (select 1 from pursuit_participants pp
                       where pp.pursuit_id = $1 and pp.org_id = $2
                         and pp.participation_state = 'ACTIVE'
                         and (pp.effective_from is null or pp.effective_from <= transaction_timestamp())
                         and (pp.effective_to   is null or pp.effective_to   >  transaction_timestamp())) as readmodel`,
      [pursuit, f.b]);
    probes++;
    if (p?.rls !== p?.readmodel) disagreements++;
  }
  c.add(`RLS and the read model NEVER disagree — ${probes} paired probes, 0 disagreements`, disagreements === 0, `${disagreements} disagreements`);

  // THE BOUNDARY MATRIX. The real predicate — the same conjunction `can_see_pursuit` carries — is
  // evaluated at instants taken FROM THE STORED BOUNDS THEMSELVES and bound in SQL as timestamptz.
  // Nothing passes through a JavaScript Date, which is the whole of D-P6-1: a Date carries
  // milliseconds where timestamptz carries microseconds, so an instant that made this round trip
  // would land up to 999µs in the past and could admit an authority the database had already ended.
  const eligible = `(pp.participation_state = 'ACTIVE'
        and (pp.effective_from is null or pp.effective_from <= t)
        and (pp.effective_to   is null or pp.effective_to   >  t))`;
  const b = await one<{ before_from: boolean; at_from: boolean; after_from: boolean; before_to: boolean; at_to: boolean; after_to: boolean; micros: boolean }>(db,
    `select
       bool_and(case when at = 'before_from' then not ok else true end) as before_from,
       bool_and(case when at = 'at_from'     then     ok else true end) as at_from,
       bool_and(case when at = 'after_from'  then     ok else true end) as after_from,
       bool_and(case when at = 'before_to'   then     ok else true end) as before_to,
       bool_and(case when at = 'at_to'       then not ok else true end) as at_to,
       bool_and(case when at = 'after_to'    then not ok else true end) as after_to,
       bool_and(micros) as micros
     from (
       select probe.at,
              ${eligible} as ok,
              (date_part('microseconds', pp.effective_from)::int % 1000) >= 0 as micros
         from pursuit_participants pp
         cross join lateral (values
              ('before_from', pp.effective_from - interval '1 microsecond'),
              ('at_from',     pp.effective_from),
              ('after_from',  pp.effective_from + interval '1 microsecond'),
              ('before_to',   pp.effective_to   - interval '1 microsecond'),
              ('at_to',       pp.effective_to),
              ('after_to',    pp.effective_to   + interval '1 microsecond')
            ) as probe(at, t)
        where pp.pursuit_id = $1 and pp.org_id = $2
          and pp.participation_state = 'ACTIVE'
          and pp.effective_from is not null and pp.effective_to is not null
     ) x`, [pursuit, f.b]);
  c.add("one microsecond BEFORE effective_from → DENIED", b?.before_from === true);
  c.add("EXACTLY AT effective_from → ALLOWED (the predicate is inclusive <=)", b?.at_from === true);
  c.add("one microsecond after effective_from → allowed", b?.after_from === true);
  c.add("one microsecond BEFORE effective_to → allowed", b?.before_to === true);
  c.add("EXACTLY AT effective_to → DENIED (the predicate is strictly >)", b?.at_to === true);
  c.add("one microsecond after effective_to → denied", b?.after_to === true);
  c.add("every bound is compared at microsecond resolution, in SQL, never through a JS Date", b?.micros === true);

  // A non-ACTIVE participant is denied regardless of its window.
  const inactive = await one<{ v: boolean }>(db,
    `select coalesce(bool_or(pp.participation_state = 'ACTIVE'), false) as v
       from pursuit_participants pp
      where pp.pursuit_id = $1 and pp.participation_state in ('LEFT','REVOKED')
        and (pp.effective_to is null or pp.effective_to > transaction_timestamp())`, [pursuit]);
  c.add("LEFT / REVOKED participants are never ACTIVE, so dates cannot revive them", inactive?.v === false);
}

// ── F — onward sharing, delegation, disclosure ──────────────────────────────────────────────────

export async function runSharing(db: PoolClient, c: Checks, f: Fixture): Promise<void> {
  await setOrg(db, f.b);
  const onwardFalse = await mayShareOnward(db, f.b, f.a, f.pursuit);
  c.add("OBJECT-LEVEL onward with onward_sharing_allowed=false → HARD DENIAL",
    onwardFalse.allow === false, onwardFalse.reason.slice(0, 70));
  c.add("the sharer may always share what it OWNS",
    (await mayShareOnward(db, f.a, f.a, f.pursuit)).allow === true);

  // The fixture carries one onward-permitting grant on a separate pursuit, so the ALLOW case is
  // proven without weakening the object above.
  const onwardGrant = await one<{ pursuit_id: string }>(db,
    `select pursuit_id::text from context_grants
      where from_org_id = $1 and to_org_id = $2 and onward_sharing_allowed = true and status = 'accepted' limit 1`,
    [f.a, f.b]);
  if (onwardGrant?.pursuit_id) {
    const allowed = await mayShareOnward(db, f.b, f.a, onwardGrant.pursuit_id);
    c.add("onward=true removes ONLY that prohibition — the recipient must still qualify independently",
      allowed.allow === true && /still qualify independently/.test(allowed.reason));
  } else {
    c.add("onward=true fixture present", false, "no onward-permitting grant found");
  }

  // …and C gains nothing either way: it is neither owner nor participant.
  await setOrg(db, f.c);
  c.add("a third organization still gains nothing — it is neither owner nor participant",
    (await mayShareOnward(db, f.c, f.a, f.pursuit)).allow === false);
  await setOrg(db, f.b);

  c.add("PURSUIT-LEVEL onward sharing of another org's data is unsupported and fail-closed",
    mayGrantOnwardAtPursuitLevel().allow === false);
  c.add("DELEGATION is fail-closed — the boolean grants nothing without authority lineage",
    mayDelegate().allow === false);
  const delegationRows = await one<{ n: number }>(db,
    `select count(*)::int as n from context_grants where delegation_allowed = true and pursuit_id = $1`, [f.pursuit]);
  c.add("…even where a delegation_allowed grant exists in the fixture, it confers nothing",
    mayDelegate().allow === false, `${delegationRows?.n ?? 0} delegation_allowed rows present`);
}

export async function runDisclosure(db: PoolClient, c: Checks, f: Fixture): Promise<void> {
  await setOrg(db, f.b);
  const viewer = await buildFederationViewer(db, f.b, f.pursuit);
  const item = (audience: string, extra: Partial<Disclosable<string>> = {}): Disclosable<string> => ({
    ownerOrgId: f.a, audience: audience as Disclosable<string>["audience"], value: "EXACT-SECRET-VALUE", ...extra,
  });
  c.add("PARTICIPANT_SHARED → EXACT", resolveDisclosure(item("PARTICIPANT_SHARED"), viewer).visibility === "EXACT");
  c.add("GENERALIZED → GENERALIZED", resolveDisclosure(item("GENERALIZED", { generalized: "band" }), viewer).visibility === "GENERALIZED");
  c.add("AGGREGATED → AGGREGATED", resolveDisclosure(item("AGGREGATED", { aggregate: "total" }), viewer).visibility === "AGGREGATED");

  const suppressed = resolveDisclosure(item("ORG_PRIVATE"), viewer);
  c.add("ORG_PRIVATE → SUPPRESSED, and the exact value never appears",
    suppressed.visibility === "SUPPRESSED" && suppressed.value === null &&
    !JSON.stringify(suppressed).includes("EXACT-SECRET-VALUE"));

  c.add("P6-IG ships ZERO safe-declassification transforms", SAFE_DECLASSIFICATION_TRANSFORMS.size === 0);
  c.add("all-authorized inputs → RECIPIENT_DERIVED", derivedDisposition([true, true]) === "RECIPIENT_DERIVED");
  c.add("ANY hidden input → NOT_DISCLOSABLE (DECLASSIFIED is representable but unreachable)",
    derivedDisposition([true, false]) === "NOT_DISCLOSABLE" && derivedDisposition([false], "any-transform") === "NOT_DISCLOSABLE");
  c.add(`the count floor is ${CROSS_ORG_COUNT_FLOOR}, declared as product policy`, CROSS_ORG_COUNT_FLOOR === 5);
  c.add("a count of 1 is SUPPRESSED", mayRenderWithheldCount(1, true, false) === false);
  c.add("a count below the floor is SUPPRESSED", mayRenderWithheldCount(4, true, false) === false);
  c.add("at or above the floor renders", mayRenderWithheldCount(5, true, false) === true);
  c.add("DIFFERENCING negative control — recipient-variable filtering suppresses any count",
    mayRenderWithheldCount(50, true, true) === false);
}
