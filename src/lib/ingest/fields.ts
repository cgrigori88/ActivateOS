/**
 * Canonical field registry for CSV intake (task #48). Partner books come from
 * whatever CRM/PRM the other side runs — column names, order, delimiter and
 * even the presence of a header row all vary. This module turns an arbitrary
 * CSV into a *proposal*: per-column profiles plus a best-guess mapping onto
 * the platform's canonical fields. A human confirms or corrects the proposal
 * before anything is imported — detection is deliberately deterministic
 * (regex + value corroboration, no AI), so raw partner data never leaves the
 * tenant during analysis.
 */

// ── Canonical fields ─────────────────────────────────────────────────────────

export type FieldGroup = "account" | "relationship" | "contact" | "commercial" | "enrichment";

export interface CanonicalField {
  key: string; // attribute key on population_members (or core column)
  label: string;
  group: FieldGroup;
  /** header-name patterns, most specific first (tested against squashed header) */
  headers: RegExp[];
  /** does a sampled value look right for this field? (corroboration signal) */
  value?: (v: string) => boolean;
  /** default surfaced state — everything detected defaults to visible */
  hint?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN_RE = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i;
const NUMBERISH_RE = /^[\s$€£]*[\d,.]+\s*[kmb]?$/i;
const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[a-z]{3,9}\.? \d{1,2},? \d{4})/i;

/**
 * The canonical registry. Keys deliberately match the attribute keys already
 * flowing through the platform (contact capture reads account_owner_email /
 * territory / vertical / segment; the old fixed-header ingest used
 * installed products / target product), so auto-mapped imports light up the
 * existing matrix, capture and evidence paths without translation.
 */
export const CANONICAL_FIELDS: CanonicalField[] = [
  {
    key: "company",
    label: "Company name",
    group: "account",
    headers: [/^(companyname|company|accountname|account|organization|organisation|orgname|customername|customer|clientname|client|businessname|name)$/],
    hint: "required — every row must name an account",
  },
  {
    key: "domain",
    label: "Website / domain",
    group: "account",
    headers: [/^(domain|website|websiteurl|site|url|web|homepage|companywebsite)$/],
    value: (v) => DOMAIN_RE.test(v),
    hint: "drives the strongest identity matches",
  },
  {
    key: "industry",
    label: "Industry",
    group: "account",
    headers: [/^(industry|sector|industryvertical|naicsdescription|sicdescription)$/],
  },
  {
    key: "employees",
    label: "Employee count",
    group: "account",
    headers: [/^(employeecount|employees|numberofemployees|noofemployees|headcount|companysize|size)$/],
    value: (v) => NUMBERISH_RE.test(v),
  },
  {
    key: "revenue",
    label: "Annual revenue",
    group: "account",
    headers: [/^(annualrevenue|revenue|arr|annualsales|sales|turnover)$/],
    value: (v) => NUMBERISH_RE.test(v),
  },
  {
    key: "country",
    label: "Country",
    group: "account",
    headers: [/^(country|countryregion|billingcountry|nation)$/],
  },
  {
    key: "state",
    label: "State / region",
    group: "account",
    headers: [/^(state|province|region|stateprovince|billingstate)$/],
  },
  {
    key: "city",
    label: "City",
    group: "account",
    headers: [/^(city|town|billingcity|locality)$/],
  },
  {
    key: "account_owner_name",
    label: "Account owner (rep) name",
    group: "relationship",
    headers: [/^(accountownername|accountowner|owner|ownername|accountmanager|accountexecutive|salesrep|rep|repname|ae|csm|assignedto)$/],
    hint: "the partner rep who owns the relationship — feeds the co-sell committee",
  },
  {
    key: "account_owner_email",
    label: "Account owner (rep) email",
    group: "relationship",
    headers: [/^(accountowneremail|owneremail|accountmanageremail|repemail|aeemail|csmemail)$/],
    value: (v) => EMAIL_RE.test(v),
  },
  {
    key: "territory",
    label: "Territory",
    group: "relationship",
    headers: [/^(territory|salesterritory|patch)$/],
  },
  {
    key: "vertical",
    label: "Vertical",
    group: "relationship",
    headers: [/^(vertical|marketvertical|subvertical)$/],
  },
  {
    key: "segment",
    label: "Segment",
    group: "relationship",
    headers: [/^(segment|marketsegment|customersegment|tier|band)$/],
  },
  {
    key: "contact_name",
    label: "Contact name",
    group: "contact",
    headers: [/^(contactname|contact|primarycontact|contactperson|fullname|person)$/],
  },
  {
    key: "contact_email",
    label: "Contact email",
    group: "contact",
    headers: [/^(contactemail|email|emailaddress|primaryemail|workemail)$/],
    value: (v) => EMAIL_RE.test(v),
    hint: "becomes a contact on the account (buying side)",
  },
  {
    key: "contact_title",
    label: "Contact title",
    group: "contact",
    headers: [/^(contacttitle|title|jobtitle|role|position|designation)$/],
  },
  {
    key: "contact_phone",
    label: "Contact phone",
    group: "contact",
    headers: [/^(contactphone|phone|phonenumber|mobile|telephone|tel)$/],
  },
  {
    key: "installed_products",
    label: "Installed products",
    group: "commercial",
    headers: [/^(installedproducts|existingproducts|products|currentproducts|installbase|installedbase|techstack|solutions|technology|technologies|technologyinstall|technologyinstalls|installedtechnology|techinstall)$/],
    hint: "claims become evidence rows (verified like any other source)",
  },
  {
    key: "target_product",
    label: "Target product / solution",
    group: "commercial",
    headers: [/^(targetproduct|targetsolution|product|solution|offering|sku|proposedproduct)$/],
  },
  {
    key: "opportunity_name",
    label: "Opportunity name",
    group: "commercial",
    headers: [/^(opportunityname|opportunity|oppname|opp|dealname|deal|pursuitname)$/],
    hint: "CRM exports: each row becomes a stage/amount snapshot compared against the live record",
  },
  {
    key: "deal_stage",
    label: "Deal stage",
    group: "commercial",
    headers: [/^(dealstage|stage|opportunitystage|salesstage|status|pipelinestage)$/],
  },
  {
    key: "deal_value",
    label: "Deal value",
    group: "commercial",
    headers: [/^(dealvalue|dealsize|opportunityvalue|opportunityamount|amount|value|acv|tcv|mrr|pipelinevalue)$/],
    value: (v) => NUMBERISH_RE.test(v),
  },
  {
    key: "close_date",
    label: "Close date",
    group: "commercial",
    headers: [/^(closedate|expectedclosedate|closingdate|estclosedate|targetclose)$/],
    value: (v) => DATE_RE.test(v),
  },
  {
    key: "renewal_date",
    label: "Renewal / expiry date",
    group: "commercial",
    headers: [/^(renewaldate|renewal|contractenddate|contractend|expirydate|expirationdate|enddate)$/],
    value: (v) => DATE_RE.test(v),
  },
  {
    key: "notes",
    label: "Notes",
    group: "commercial",
    headers: [/^(notes|note|comments|comment|description|remarks|context)$/],
  },
  {
    key: "intent_score",
    label: "Intent / surge score",
    group: "enrichment",
    headers: [/^(intent|intentscore|buyerintent|surge|surgescore|intentlevel|buyingstage)$/],
    hint: "Enrichment exports (HG Insights, Bombora…): lands as third-party evidence feeding the next scoring sweep",
  },
  {
    key: "it_spend",
    label: "IT spend / budget",
    group: "enrichment",
    headers: [/^(itspend|itbudget|techspend|techbudget|spend|estimatedspend|verticalitspend)$/],
    value: (v) => NUMBERISH_RE.test(v.replace(/[$,kKmM]/g, "")),
    hint: "Enrichment exports: lands as third-party evidence feeding the next scoring sweep",
  },
  {
    key: "health_score",
    label: "Health / NPS score",
    group: "enrichment",
    headers: [/^(health|healthscore|customerhealth|nps|npsscore|csat|riskscore)$/],
    hint: "Gainsight-style exports: lands as third-party evidence feeding the next scoring sweep",
  },
];

export const FIELD_BY_KEY = new Map(CANONICAL_FIELDS.map((f) => [f.key, f]));

export const GROUP_LABEL: Record<FieldGroup, string> = {
  account: "Account identity",
  relationship: "Relationship / coverage",
  contact: "Contacts",
  commercial: "Commercial",
  enrichment: "Enrichment signals",
};


// ── Shared shapes ────────────────────────────────────────────────────────────

export type InferredType = "email" | "domain" | "number" | "date" | "text";

export interface ColumnProfile {
  index: number;
  header: string;
  type: InferredType;
  fillRate: number; // 0..1
  samples: string[]; // up to 3 distinct non-empty values (truncated)
}

export interface ColumnMapping {
  index: number;
  header: string;
  /** canonical field key, or a custom attribute key, or "" = don't import */
  target: string;
  custom: boolean; // target is a custom (pass-through) field
  confidence: number; // 0..1 (1 = header + values agree; custom fields get 0)
  surfaced: boolean;
}

/** "Account Owner Email " → accountowneremail (for header matching) */
export function squashHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "Account Owner Email" → account_owner_email (for custom attribute keys) */
export function customKey(h: string): string {
  const k = h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return k || "field";
}
