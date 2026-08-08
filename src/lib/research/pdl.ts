/**
 * People Data Labs company enrichment — the plan's first paid data source
 * (PROJECT_BRIEF §6), used for normalized firmographics on the company
 * identity record. Free tier for testing; requires PDL_API_KEY.
 */

export interface PdlCompany {
  name: string | null;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  region: string | null;
}

export function pdlAvailable(): boolean {
  return Boolean(process.env.PDL_API_KEY);
}

export async function enrichCompanyByDomain(domain: string): Promise<PdlCompany | null> {
  const apiKey = process.env.PDL_API_KEY;
  if (!apiKey) throw new Error("PDL_API_KEY is not set");
  const res = await fetch(
    `https://api.peopledatalabs.com/v5/company/enrich?website=${encodeURIComponent(domain)}`,
    { headers: { "X-Api-Key": apiKey } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PDL enrich failed: ${res.status} ${await res.text()}`);
  const d = (await res.json()) as {
    status: number;
    name?: string;
    industry?: string;
    employee_count?: number;
    location?: { country?: string; region?: string };
  };
  if (d.status !== 200) return null;
  return {
    name: d.name ?? null,
    industry: d.industry ?? null,
    employeeCount: d.employee_count ?? null,
    country: d.location?.country ?? null,
    region: d.location?.region ?? null,
  };
}
