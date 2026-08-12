import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Capture partner-rep contacts from mapped account lists into the contacts
 * taxonomy. Every approved partner population carries, per account, the partner
 * rep who owns that relationship (attributes.account_owner_name / _email) plus
 * the territory / vertical / segment it sits in. We materialize those as typed
 * contacts (contact_type = the partner's type) so the *selling* side of the
 * co-sell committee lives alongside the *buying* side (end users).
 *
 * A rep who covers several accounts yields one row per account — that's the
 * intended grain (the same rep shows under each account they own). Captured rows
 * are tagged source='population' and rebuilt wholesale each run, so this is
 * idempotent and always reflects the current mappings.
 */
export async function captureContactsFromPopulations(
  db: Db,
  orgId: string,
): Promise<{ inserted: number }> {
  await db.query(`delete from contacts where org_id = $1 and source = 'population'`, [orgId]);

  const { rowCount } = await db.query(
    `insert into contacts
       (org_id, company_id, partner_id, email, name, title, contact_type, location, source, attributes)
     select $1,
            pm.company_id,
            ap.partner_id,
            lower(pm.attributes->>'account_owner_email'),
            nullif(pm.attributes->>'account_owner_name', ''),
            'Partner rep · ' || p.name,
            coalesce(p.partner_type, 'other'),
            nullif(pm.attributes->>'territory', ''),
            'population',
            jsonb_strip_nulls(jsonb_build_object(
              'role',         'account_owner',
              'partner_name', p.name,
              'territory',    nullif(pm.attributes->>'territory', ''),
              'vertical',     nullif(pm.attributes->>'vertical', ''),
              'segment',      nullif(pm.attributes->>'segment', '')
            ))
     from population_members pm
     join account_populations ap on ap.id = pm.population_id
     join partners p on p.id = ap.partner_id
     where ap.org_id = $1
       and ap.partner_id is not null
       and ap.status = 'approved'
       and coalesce(pm.attributes->>'account_owner_email', '') <> ''`,
    [orgId],
  );

  return { inserted: rowCount ?? 0 };
}
