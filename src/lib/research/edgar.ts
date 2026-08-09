/**
 * SEC EDGAR connector — free, keyless, high-value for public companies
 * (PROJECT_BRIEF §6: day-1 $0 data). Fetches recent filings text for the
 * Extractor. SEC requires a descriptive User-Agent.
 */

const UA = "PursuitOS research (contact: tpcchris1@gmail.com)";

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export async function lookupCIK(companyName: string): Promise<{ cik: string; title: string } | null> {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`EDGAR ticker lookup failed: ${res.status}`);
  const data = (await res.json()) as Record<string, TickerEntry>;
  const needle = companyName.toLowerCase();
  for (const entry of Object.values(data)) {
    if (entry.title.toLowerCase().includes(needle)) {
      return { cik: String(entry.cik_str).padStart(10, "0"), title: entry.title };
    }
  }
  return null;
}

export interface EdgarFiling {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
}

export async function recentFilings(
  cik: string,
  forms: string[] = ["8-K", "10-K", "10-Q"],
  limit = 5,
): Promise<EdgarFiling[]> {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`EDGAR submissions failed: ${res.status}`);
  const data = (await res.json()) as {
    filings: { recent: { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] } };
  };
  const r = data.filings.recent;
  const out: EdgarFiling[] = [];
  for (let i = 0; i < r.form.length && out.length < limit; i++) {
    if (forms.includes(r.form[i])) {
      out.push({
        form: r.form[i],
        filingDate: r.filingDate[i],
        accessionNumber: r.accessionNumber[i],
        primaryDocument: r.primaryDocument[i],
      });
    }
  }
  return out;
}

export async function filingText(cik: string, filing: EdgarFiling): Promise<string> {
  const accession = filing.accessionNumber.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${filing.primaryDocument}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`EDGAR document fetch failed: ${res.status}`);
  const html = await res.text();
  // Strip tags/entities to plain text; the Extractor handles the rest.
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function filingUrl(cik: string, filing: EdgarFiling): string {
  const accession = filing.accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${filing.primaryDocument}`;
}
