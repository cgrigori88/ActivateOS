import type { PoolClient } from "pg";
import { cookies } from "next/headers";
import { withTenant } from "@/lib/db/tenant";
import {
  ALL_SCOPE,
  parseScope,
  SCOPE_COOKIE,
  SCOPE_PARAM,
  type Scope,
  type ScopeContext,
  type ScopeOption,
} from "./scope";

/**
 * Server-side scope authorization + data derivation (scale-disclosure §1, R1).
 *
 * A scope resolves to a set of authorized company ids INSIDE the tenant's RLS-scoped set. Rooms
 * apply that set as an additional `company_id IN (...)` narrowing — it can only sub-select the
 * org's own rows, never reveal another tenant's, and an id the principal is not authorized for
 * (foreign / stale) yields ZERO rows, not a widened set. Every query below is org-scoped and runs
 * under `withTenant`, so authorization is re-evaluated on every request regardless of the URL.
 */

export interface ResolvedScope {
  scope: Scope;
  label: string;
  facts: string[];
  /**
   * Company ids the scope narrows to. `null` = no restriction (ALL). An empty array is a VALID
   * scope that happens to match no accounts (room shows an explicit empty state, never invents rows).
   */
  companyIds: string[] | null;
}

const ACTIVE_MOTION = "status in ('active','approved')";

/** Derive the scope options that actually have data in this tenant (empty kinds are hidden). */
export async function deriveScopeOptions(db: PoolClient, orgId: string): Promise<ScopeOption[]> {
  const opts: ScopeOption[] = [{ kind: "ALL", id: null, label: "All (my authorized set)", group: "" }];

  const partners = await db.query<{ id: string; name: string }>(
    `select p.id, p.name from partners p
      where p.org_id = $1 and (
        exists (select 1 from revenue_motions m where m.partner_id = p.id and m.org_id = $1)
        or exists (select 1 from sellers s where s.partner_id = p.id and s.org_id = $1)
        or exists (select 1 from account_populations ap where ap.partner_id = p.id and ap.org_id = $1))
      order by p.name`,
    [orgId],
  );
  for (const r of partners.rows) opts.push({ kind: "PARTNER", id: r.id, label: r.name, group: "Partner" });

  const vendors = await db.query<{ id: string; name: string }>(
    `select distinct v.id, v.name from vendors v
       join sellers s on s.vendor_id = v.id and s.org_id = $1
      where v.org_id = $1 order by v.name`,
    [orgId],
  );
  for (const r of vendors.rows) opts.push({ kind: "VENDOR", id: r.id, label: r.name, group: "Vendor" });

  const terrs = await db.query<{ territory: string }>(
    `select distinct territory from sellers
      where org_id = $1 and territory is not null and territory <> '' order by territory`,
    [orgId],
  );
  for (const r of terrs.rows) opts.push({ kind: "TERRITORY", id: r.territory, label: r.territory, group: "Territory" });

  const sellers = await db.query<{ id: string; name: string }>(
    `select s.id, s.name from sellers s
      where s.org_id = $1
        and exists (select 1 from seller_account_relationships r where r.seller_id = s.id)
      order by s.name limit 50`,
    [orgId],
  );
  for (const r of sellers.rows) opts.push({ kind: "SELLER", id: r.id, label: r.name, group: "Seller" });

  // Personal ("my active book") is offered whenever there's an active book to scope to.
  const hasBook = await db.query<{ n: string }>(
    `select (
       (select count(*) from pursuits where account_id is not null and status not in ('WON','LOST','DISQUALIFIED'))
       + (select count(*) from revenue_motions where ${ACTIVE_MOTION})
     )::text n`,
  );
  if (Number(hasBook.rows[0]?.n ?? 0) > 0) opts.push({ kind: "PERSONAL", id: null, label: "My active book", group: "Personal" });

  return opts;
}

/** Resolve a scope to its authorized company-id set + chip facts. Fail-safe: unknown → ALL. */
export async function resolveScope(db: PoolClient, orgId: string, scope: Scope): Promise<ResolvedScope> {
  if (scope.kind === "ALL") return { scope, label: "All", facts: [], companyIds: null };

  const distinct = async (sql: string, params: unknown[]): Promise<string[]> =>
    (await db.query<{ company_id: string }>(sql, params)).rows.map((r) => r.company_id);

  if (scope.kind === "PARTNER" && scope.id) {
    const name = (await db.query<{ name: string }>(`select name from partners where id = $1 and org_id = $2`, [scope.id, orgId])).rows[0]?.name;
    if (!name) return fallbackAll(scope);
    const companyIds = await distinct(
      `select distinct company_id from (
         select company_id from revenue_motions where partner_id = $1 and org_id = $2
         union select r.company_id from seller_account_relationships r join sellers s on s.id = r.seller_id where s.partner_id = $1 and s.org_id = $2
         union select pm.company_id from population_members pm join account_populations ap on ap.id = pm.population_id where ap.partner_id = $1 and ap.org_id = $2
       ) x`,
      [scope.id, orgId],
    );
    const motions = Number((await db.query<{ n: string }>(`select count(*)::text n from revenue_motions where partner_id = $1 and org_id = $2 and ${ACTIVE_MOTION}`, [scope.id, orgId])).rows[0].n);
    return { scope, label: name, companyIds, facts: [accts(companyIds.length), `${motions} active motion${motions === 1 ? "" : "s"}`] };
  }

  if (scope.kind === "VENDOR" && scope.id) {
    const name = (await db.query<{ name: string }>(`select name from vendors where id = $1 and org_id = $2`, [scope.id, orgId])).rows[0]?.name;
    if (!name) return fallbackAll(scope);
    const companyIds = await distinct(
      `select distinct r.company_id from seller_account_relationships r join sellers s on s.id = r.seller_id where s.vendor_id = $1 and s.org_id = $2`,
      [scope.id, orgId],
    );
    return { scope, label: name, companyIds, facts: [accts(companyIds.length)] };
  }

  if (scope.kind === "TERRITORY" && scope.id) {
    const companyIds = await distinct(
      `select distinct r.company_id from seller_account_relationships r join sellers s on s.id = r.seller_id where s.territory = $1 and s.org_id = $2`,
      [scope.id, orgId],
    );
    return { scope, label: scope.id, companyIds, facts: [accts(companyIds.length)] };
  }

  if (scope.kind === "SELLER" && scope.id) {
    const name = (await db.query<{ name: string }>(`select name from sellers where id = $1 and org_id = $2`, [scope.id, orgId])).rows[0]?.name;
    if (!name) return fallbackAll(scope);
    const companyIds = await distinct(`select distinct company_id from seller_account_relationships where seller_id = $1`, [scope.id]);
    return { scope, label: name, companyIds, facts: [accts(companyIds.length)] };
  }

  if (scope.kind === "PERSONAL") {
    // Belt-and-suspenders org scoping (matches every branch above): explicit org_id so
    // the scope is bounded by the tenant even while the app_rw/RLS cutover is latent —
    // a narrowing lens must never depend on RLS alone to avoid widening cross-tenant.
    const companyIds = await distinct(
      `select distinct company_id from (
         select account_id company_id from pursuits where org_id = $1 and account_id is not null and status not in ('WON','LOST','DISQUALIFIED')
         union select company_id from revenue_motions where org_id = $1 and ${ACTIVE_MOTION}
       ) x`,
      [orgId],
    );
    return { scope, label: "My active book", companyIds, facts: [`${companyIds.length} active account${companyIds.length === 1 ? "" : "s"}`] };
  }

  return fallbackAll(scope);
}

function fallbackAll(scope: Scope): ResolvedScope {
  void scope;
  return { scope: ALL_SCOPE, label: "All", facts: [], companyIds: null };
}
function accts(n: number): string {
  return `${n} account${n === 1 ? "" : "s"}`;
}

/**
 * Read the active scope for a page render. Prefers the URL `?scope=` (shareable, re-authorized
 * server-side) and falls back to the persisted cookie. Pass the page's own searchParams; the
 * cookie is read here. Returns a fully-resolved context (label + facts + companyIds).
 */
export async function getScopeContext(searchParamScope?: string | null): Promise<ResolvedScope> {
  let raw = searchParamScope ?? null;
  if (!raw) {
    try {
      raw = (await cookies()).get(SCOPE_COOKIE)?.value ?? null;
    } catch {
      /* outside request scope — ALL */
    }
  }
  const scope = parseScope(raw);
  if (scope.kind === "ALL") return { scope, label: "All", facts: [], companyIds: null };
  try {
    return await withTenant((db, orgId) => resolveScope(db, orgId, scope));
  } catch {
    return { scope: ALL_SCOPE, label: "All", facts: [], companyIds: null };
  }
}

/** Lightweight scope context for the shell/chip: options + active resolved scope. Cookie-driven. */
export async function getShellScope(): Promise<{ options: ScopeOption[]; active: ScopeContext }> {
  let raw: string | null = null;
  try {
    raw = (await cookies()).get(SCOPE_COOKIE)?.value ?? null;
  } catch {
    /* build pass */
  }
  const scope = parseScope(raw);
  try {
    return await withTenant(async (db, orgId) => {
      const options = await deriveScopeOptions(db, orgId);
      const resolved = scope.kind === "ALL"
        ? { scope, label: "All", facts: [] as string[], companyIds: null }
        : await resolveScope(db, orgId, scope);
      return { options, active: { scope: resolved.scope, label: resolved.label, facts: resolved.facts } };
    });
  } catch {
    return { options: [{ kind: "ALL", id: null, label: "All (my authorized set)", group: "" }], active: { scope: ALL_SCOPE, label: "All", facts: [] } };
  }
}

/** Pull the raw `scope=` token out of a page's searchParams (for getScopeContext). */
export function scopeParamFrom(searchParams: Record<string, string | string[] | undefined>): string | null {
  const v = searchParams[SCOPE_PARAM];
  return typeof v === "string" ? v : null;
}
