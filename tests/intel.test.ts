import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyJob,
  computeHiringFeatures,
  hiringEvidence,
  type HiringSnapshot,
  type JobPosting,
} from "../src/lib/intel/hiring";
import { detectDnsChanges, detectVendors, type DnsSnapshot } from "../src/lib/intel/providers/dns";
import { dataCompleteness, escalationReason } from "../src/lib/intel/screen";
import { contentHash } from "../src/lib/intel/pipeline";
import { GreenhouseProvider } from "../src/lib/intel/providers/greenhouse";
import { LeverProvider } from "../src/lib/intel/providers/lever";

const NOW = new Date("2026-08-09T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function job(id: string, title: string, publishedAt: Date | null = null): JobPosting {
  return { externalId: id, title, department: null, location: null, url: null, publishedAt };
}

test("classifyJob: role families, leadership, non-technical exclusion", () => {
  assert.deepEqual(classifyJob("Senior Platform Engineer").families, ["platform_engineering"]);
  assert.ok(classifyJob("SRE / Automation Engineer (Ansible)").families.includes("automation"));
  assert.ok(classifyJob("Kubernetes Platform Engineer").families.includes("kubernetes"));
  assert.deepEqual(classifyJob("Account Executive").families, []);
  assert.equal(classifyJob("VP Infrastructure Engineering").leadership, true);
  assert.equal(classifyJob("VP of Sales").leadership, false); // leadership but not technical
});

test("hiring velocity: counts, 30d additions, growth, new leadership", () => {
  const current: HiringSnapshot = {
    observedAt: NOW,
    jobs: [
      job("1", "Platform Engineer", daysAgo(10)),
      job("2", "Platform Engineer II", daysAgo(5)),
      job("3", "Senior Platform Engineer", daysAgo(60)),
      job("4", "Cloud Automation Engineer", daysAgo(3)),
      job("5", "VP Infrastructure Engineering", daysAgo(2)),
      job("6", "Accountant", daysAgo(1)), // irrelevant
    ],
  };
  const history: HiringSnapshot[] = [
    { observedAt: daysAgo(45), jobs: [job("3", "Senior Platform Engineer", daysAgo(60))] },
  ];
  const f = computeHiringFeatures(current, history, NOW);
  // VP role is leadership, not a role family — counted separately below.
  assert.equal(f.relevantJobsCurrent, 4);
  assert.equal(f.byFamily.platform_engineering, 3);
  assert.ok(f.newRelevantJobs30d >= 3); // ids 1,2,4 first seen inside 30d
  assert.ok(f.growth30d != null && f.growth30d > 0); // 1 relevant → 5 relevant
  assert.equal(f.newLeadershipRoles.length, 1);
  assert.match(f.newLeadershipRoles[0].title, /VP Infrastructure/);
});

test("hiring evidence: thresholds gate noise, claims state observable facts", () => {
  const few = computeHiringFeatures(
    { observedAt: NOW, jobs: [job("1", "Platform Engineer")] },
    [],
    NOW,
  );
  assert.equal(hiringEvidence(few, "Acme", null).length, 0); // 1 job = noise

  const many = computeHiringFeatures(
    {
      observedAt: NOW,
      jobs: [
        job("1", "Platform Engineer", daysAgo(5)),
        job("2", "Platform Engineer II", daysAgo(6)),
        job("3", "Staff Platform Engineer", daysAgo(7)),
      ],
    },
    [],
    NOW,
  );
  const ev = hiringEvidence(many, "Acme", "https://boards.greenhouse.io/acme");
  assert.equal(ev.length, 1);
  assert.match(ev[0].claim, /Acme currently lists 3 open platform engineering roles/);
  assert.equal(ev[0].firstParty, true);
  assert.equal(ev[0].suggestedSignalType, "PLATFORM_ENGINEERING_EXPANSION");
});

test("greenhouse fixture normalizes through the shared hiring model", () => {
  const provider = new GreenhouseProvider();
  const payload = {
    board: "acme",
    jobs: [
      { id: 1, title: "Platform Engineer", first_published: daysAgo(4).toISOString() },
      { id: 2, title: "Platform Engineer, Core", first_published: daysAgo(6).toISOString() },
      { id: 3, title: "Principal Platform Engineer", first_published: daysAgo(8).toISOString() },
    ],
  };
  const candidates = provider.normalize(
    [{ payload, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].claim, /3 open platform engineering roles/);
  // Unchanged snapshot produces nothing.
  assert.equal(provider.normalize([{ payload, isNew: false }], [], {
    orgId: null, companyId: "c1", companyName: "Acme", domain: null,
  }).length, 0);
});

test("lever fixture maps into the same model", () => {
  const provider = new LeverProvider();
  const payload = {
    slug: "acme",
    jobs: [
      { id: "a", text: "Kubernetes Engineer", createdAt: daysAgo(3).getTime() },
      { id: "b", text: "Kubernetes Platform Engineer", createdAt: daysAgo(4).getTime() },
      { id: "c", text: "OpenShift Administrator", createdAt: daysAgo(5).getTime() },
    ],
  };
  const candidates = provider.normalize(
    [{ payload, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: null },
  );
  assert.ok(candidates.some((c) => c.suggestedSignalType === "KUBERNETES_HIRING"));
});

test("dns vendor detection is conservative and change-aware", () => {
  const before: DnsSnapshot = {
    domain: "acme.com",
    records: {
      MX: ["10 aspmx.l.google.com."],
      TXT: ['"v=spf1 include:_spf.google.com ~all"'],
      NS: ["ns1.oldhost.com.", "ns2.oldhost.com."],
      A: [], CNAME: [],
    },
  };
  const after: DnsSnapshot = {
    domain: "acme.com",
    records: {
      MX: ["10 acme-com.mail.protection.outlook.com."],
      TXT: ['"v=spf1 include:spf.protection.outlook.com -all"'],
      NS: ["ns1.cloudflare.com.", "ns2.cloudflare.com."],
      A: [], CNAME: [],
    },
  };
  const vendors = detectVendors(after).map((v) => v.vendor);
  assert.ok(vendors.includes("Microsoft 365"));
  assert.ok(vendors.includes("Cloudflare"));

  const changes = detectDnsChanges(before, after);
  const types = changes.map((c) => c.signalType);
  assert.ok(types.includes("MAIL_PLATFORM_CHANGE"));
  assert.ok(types.includes("DNS_PROVIDER_CHANGE"));
  assert.match(
    changes.find((c) => c.signalType === "MAIL_PLATFORM_CHANGE")!.claim,
    /Google Workspace → Microsoft 365/,
  );
  // No change → no events.
  assert.equal(detectDnsChanges(after, after).length, 0);
});

test("escalation rules route deep research to where it pays", () => {
  const base = {
    score: 70, band: "high", evidenceConfidence: 80,
    dataCompleteness: 90, openContradictions: 0, estimatedValueUsd: null,
  };
  assert.equal(escalationReason(base), null); // healthy high account: no spend
  assert.equal(
    escalationReason({ ...base, openContradictions: 1 }),
    "signal_contradiction",
  );
  assert.equal(
    escalationReason({ ...base, evidenceConfidence: 45 }),
    "high_propensity_low_confidence",
  );
  assert.equal(
    escalationReason({ ...base, score: 20, band: "low", estimatedValueUsd: 200_000, dataCompleteness: 30 }),
    "high_value_low_completeness",
  );
  assert.equal(
    escalationReason({ ...base, score: 62, evidenceConfidence: 90 }),
    "score_near_threshold",
  );
  assert.equal(dataCompleteness(2, 3), 67);
  assert.equal(dataCompleteness(0, 0), 0);
});

test("contentHash is stable and order-independent via caller sorting", () => {
  assert.equal(contentHash("a|b"), contentHash("a|b"));
  assert.notEqual(contentHash("a|b"), contentHash("a|c"));
  assert.equal(contentHash("x").length, 32);
});

// -- BuiltWith (P1-B): fixtures mirror BuiltWith's DOCUMENTED response
// shapes — test fixtures only, never real account intelligence. ----------

test("domain normalization strips scheme/path/www/email; rejects junk", async () => {
  const { normalizeDomain } = await import("../src/lib/intel/domain");
  assert.equal(normalizeDomain("https://www.acme.com/path?q=1"), "acme.com");
  assert.equal(normalizeDomain("www.acme.com"), "acme.com");
  assert.equal(normalizeDomain("acme.com"), "acme.com");
  assert.equal(normalizeDomain("http://sub.acme.co.uk:8080/x"), "sub.acme.co.uk");
  assert.equal(normalizeDomain("jane@acme.com"), "acme.com"); // email → its domain
  assert.equal(normalizeDomain("ACME.COM."), "acme.com");
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("localhost"), null); // no TLD
  assert.equal(normalizeDomain(null), null); // → SKIP_NO_DOMAIN
});

test("builtwith_free: category profile → conservative ontology evidence", async () => {
  const { BuiltWithFreeProvider, relevantCategories } = await import(
    "../src/lib/intel/providers/builtwith"
  );
  // Shape mirrors the LIVE free1 API: group/category counts with recency.
  const fixture = {
    domain: "acme.com",
    groups: [
      {
        name: "operations",
        live: 5,
        categories: [
          { name: "Kubernetes", live: 3, latest: 1786233600000 },
          { name: "Bookmarking", live: 0 }, // dead → skipped
        ],
      },
      { name: "hosting", live: 2, categories: [{ name: "Cloud Hosting", live: 4, latest: 1786233600000 }] },
      { name: "widgets", live: 9, categories: [{ name: "Social Sharing", live: 9 }] }, // irrelevant group
    ],
  };
  const cats = relevantCategories(fixture);
  assert.ok(cats.some((c) => c.category === "Kubernetes"));
  assert.ok(!cats.some((c) => c.group === "widgets")); // irrelevant group excluded
  assert.ok(!cats.some((c) => c.category === "Bookmarking")); // dead category excluded

  const provider = new BuiltWithFreeProvider();
  assert.equal(provider.providerId, "builtwith_free");
  assert.equal(provider.costClass, "FREE");
  const candidates = provider.normalize(
    [{ payload: { domain: "acme.com", categories: cats }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  const k8s = candidates.find((c) => c.suggestedNodeSlug === "kubernetes");
  assert.ok(k8s);
  // Category-level phrasing — explicitly NOT a product-install claim.
  assert.match(k8s.claim, /free category profile.*shows active/);
  assert.ok(!/uses|installed/i.test(k8s.claim));

  // No key or no domain = SKIP_NO_DOMAIN (absence), never a guess.
  const saved = process.env.BUILTWITH_API_KEY;
  delete process.env.BUILTWITH_API_KEY;
  try {
    assert.deepEqual(
      await provider.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
      [],
    );
  } finally {
    if (saved) process.env.BUILTWITH_API_KEY = saved;
  }
  assert.deepEqual(
    await provider.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "not-a-domain" }),
    [],
  );
});

test("builtwith_domain / builtwith_change: credit-gated, deep, disabled by default", async () => {
  const { BuiltWithDomainProvider, BuiltWithChangeProvider, extractTechnologies, extractChanges } =
    await import("../src/lib/intel/providers/builtwith");
  const domain = new BuiltWithDomainProvider();
  const change = new BuiltWithChangeProvider();

  // Deep-stage, and disabled until BUILTWITH_CREDITS=true.
  assert.equal(domain.allowedForScreening, false);
  assert.equal(change.allowedForScreening, false);
  const savedCredits = process.env.BUILTWITH_CREDITS;
  delete process.env.BUILTWITH_CREDITS;
  assert.equal(domain.disabledReason, "DISABLED_NO_CREDITS");
  assert.equal(change.disabledReason, "DISABLED_NO_CREDITS");
  process.env.BUILTWITH_CREDITS = "true";
  assert.equal(domain.disabledReason, undefined); // flips on when credits exist
  if (savedCredits) process.env.BUILTWITH_CREDITS = savedCredits;
  else delete process.env.BUILTWITH_CREDITS;

  // Extraction helpers still work for when credits arrive.
  const techs = extractTechnologies({
    Results: [{ Result: { Paths: [{ Technologies: [{ Name: "Kubernetes" }, { Name: "Ansible" }] }] } }],
  });
  assert.equal(techs.length, 2);
  const changes = extractChanges({
    Changes: [{ Technology: "Ansible", Type: "Added", Date: "2026-07-20" }],
  });
  assert.deepEqual(changes.map((c) => c.type), ["added"]);
});

// -- IPinfo Lite (P1-D): fixtures mirror the LIVE response shape ---------

test("ipinfo: cloud detection, distinct networks, change events", async () => {
  const { IpinfoProvider, detectNetworkChanges, distinctNetworks, isCloudNetwork } = await import(
    "../src/lib/intel/providers/ipinfo"
  );
  const snap = {
    domain: "acme.com",
    entries: [
      { ip: "18.1.1.1", asn: "AS16509", as_name: "Amazon.com, Inc.", as_domain: "amazon.com", country: "US", continent: "NA" },
      { ip: "18.1.1.2", asn: "AS16509", as_name: "Amazon.com, Inc.", as_domain: "amazon.com", country: "NL", continent: "EU" },
    ],
  };
  assert.equal(distinctNetworks(snap).length, 1); // same ASN across IPs = one network
  assert.equal(isCloudNetwork(snap.entries[0]), true);

  const provider = new IpinfoProvider();
  const candidates = provider.normalize(
    [{ payload: snap, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].suggestedSignalType, "CLOUD_NETWORK_EVIDENCE");
  assert.match(candidates[0].claim, /route through Amazon/);
  // Location never appears in evidence claims.
  assert.ok(!/US|Netherlands|NA|EU/.test(candidates[0].claim));

  // Provider change: AWS → Cloudflare.
  const moved = {
    domain: "acme.com",
    entries: [
      { ip: "104.1.1.1", asn: "AS13335", as_name: "Cloudflare, Inc.", as_domain: "cloudflare.com", country: "US", continent: "NA" },
    ],
  };
  const changes = detectNetworkChanges(snap, moved);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].signalType, "NETWORK_PROVIDER_CHANGE");
  assert.match(changes[0].claim, /amazon\.com → cloudflare\.com/);

  // Same provider, different ASN = infrastructure change, not provider change.
  const shuffled = {
    domain: "acme.com",
    entries: [
      { ip: "3.1.1.1", asn: "AS14618", as_name: "Amazon.com, Inc.", as_domain: "amazon.com", country: "US", continent: "NA" },
    ],
  };
  const infra = detectNetworkChanges(snap, shuffled);
  assert.equal(infra.length, 1);
  assert.equal(infra[0].signalType, "NETWORK_INFRASTRUCTURE_CHANGE");

  // No token = absence, not error; weekly throttle declared.
  const saved = process.env.IPINFO_TOKEN;
  delete process.env.IPINFO_TOKEN;
  try {
    assert.deepEqual(
      await provider.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
      [],
    );
  } finally {
    if (saved) process.env.IPINFO_TOKEN = saved;
  }
  assert.equal(provider.minRefreshHours, 24 * 7);
});

// -- Wappalyzer (P1-C): plan-blocked provider state ----------------------

test("wappalyzer registers DISABLED_NO_PLAN_ACCESS and never runs", async () => {
  const { WappalyzerProvider } = await import("../src/lib/intel/providers/wappalyzer");
  const p = new WappalyzerProvider();
  assert.equal(p.disabledReason, "DISABLED_NO_PLAN_ACCESS");
  assert.deepEqual(await p.fetch({ orgId: null, companyId: "c", companyName: "A", domain: "a.com" }), []);
  const health = await p.healthCheck();
  assert.equal(health.ok, false);
  assert.equal(health.detail, "DISABLED_NO_PLAN_ACCESS");
});

// -- Censys (P2-B): fixtures mirror the LIVE platform API shape ----------

test("censys: relevance gate, finer signal vocabulary, careful claims", async () => {
  const { CensysProvider, summarizeHost, certIssuerOrg, detectInfraChange, isCensysRelevant } =
    await import("../src/lib/intel/providers/censys");
  const p = new CensysProvider();
  assert.equal(p.allowedForScreening, false); // never in the universal screen
  assert.equal(p.minRefreshHours, 24 * 30);

  // Category gate: infra-relevant slugs pass; unrelated ones don't.
  assert.equal(isCensysRelevant("infrastructure-automation"), true);
  assert.equal(isCensysRelevant("security"), true);
  assert.equal(isCensysRelevant("analytics"), false);

  assert.equal(certIssuerOrg({ parsed: { issuer_dn: "C=US, O=Let's Encrypt, CN=R3" } }), "Let's Encrypt");
  assert.equal(certIssuerOrg({}), null);

  const host = {
    ip: "203.0.113.10",
    autonomous_system: { asn: 16509, name: "AMAZON-02 - Amazon.com, Inc." },
    service_count: 3,
    services: [
      {
        port: 443, protocol: "HTTP", transport_protocol: "tcp",
        software: [{ product: "OpenShift", vendor: "Red Hat" }],
        cert: { parsed: { issuer_dn: "C=US, O=DigiCert Inc, CN=DigiCert TLS" } },
      },
      { port: 22, protocol: "SSH", transport_protocol: "tcp" },
      { port: 443, protocol: "UNKNOWN", transport_protocol: "quic" }, // filtered
    ],
  };
  const s = summarizeHost(host);
  assert.deepEqual(s.protocols, ["HTTP", "SSH"]);
  assert.deepEqual(s.software, ["OpenShift"]);
  assert.deepEqual(s.certIssuers, ["DigiCert Inc"]);
  assert.equal(s.cloudProvider, "AMAZON-02 - Amazon.com, Inc.");

  const candidates = p.normalize(
    [{ payload: { domain: "acme.com", hosts: [host] }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  const types = candidates.map((c) => c.suggestedSignalType);
  assert.ok(types.includes("INTERNET_FACING_INFRASTRUCTURE_EVIDENCE"));
  assert.ok(types.includes("CLOUD_INFRASTRUCTURE_EVIDENCE"));
  assert.ok(types.includes("CERTIFICATE_INFRASTRUCTURE_EVIDENCE"));
  assert.ok(types.includes("PUBLIC_SERVICE_DETECTED"));
  const svc = candidates.find((c) => c.suggestedSignalType === "PUBLIC_SERVICE_DETECTED")!;
  assert.equal(svc.suggestedNodeSlug, "kubernetes");
  // NEVER internal-use, vulnerability, or exposure language.
  for (const c of candidates) {
    assert.ok(!/uses .* internally|vulnerab|insecure|exposed|risk|CVE/i.test(c.claim));
  }

  // Change detection: a new service since the prior snapshot.
  const prev = { domain: "acme.com", hosts: [{ ip: "203.0.113.10", services: [{ port: 443, protocol: "HTTP" }] }] };
  const change = detectInfraChange(prev, { domain: "acme.com", hosts: [host] });
  assert.match(change ?? "", /new: 22\/SSH/);

  // No PAT = absence, not error.
  const saved = process.env.CENSYS_PAT;
  delete process.env.CENSYS_PAT;
  try {
    assert.deepEqual(
      await p.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
      [],
    );
  } finally {
    if (saved) process.env.CENSYS_PAT = saved;
  }
});

// -- Orchestration policy (§17-24): when each provider fires -------------

test("shouldRunProvider: stage, public-company, category, and threshold gates", async () => {
  const { shouldRunProvider } = await import("../src/lib/intel/policy");
  const base = {
    targetSlug: "infrastructure-automation",
    researchStage: "screen" as const,
    isPublicCompany: false,
    researchTriggered: false,
    enabled: true,
  };

  // Tier-2 cheap providers run in the screen.
  assert.equal(shouldRunProvider({ ...base, providerId: "greenhouse" }).run, true);
  assert.equal(shouldRunProvider({ ...base, providerId: "dns" }).run, true);

  // Disabled provider never runs, whatever the stage.
  assert.equal(shouldRunProvider({ ...base, providerId: "wappalyzer", enabled: false }).run, false);

  // SEC only for public companies.
  assert.equal(shouldRunProvider({ ...base, providerId: "sec_edgar" }).run, false);
  assert.match(shouldRunProvider({ ...base, providerId: "sec_edgar" }).reason, /public-company/);
  assert.equal(
    shouldRunProvider({ ...base, providerId: "sec_edgar", isPublicCompany: true }).run,
    true,
  );

  // GitHub only when the category is engineering-observable.
  assert.equal(shouldRunProvider({ ...base, providerId: "github" }).run, true); // infra-automation
  assert.equal(
    shouldRunProvider({ ...base, providerId: "github", targetSlug: "siem" }).run,
    false,
  );

  // Censys is deep-stage only, and category-gated even there.
  assert.equal(shouldRunProvider({ ...base, providerId: "censys" }).run, false); // screen stage
  assert.match(shouldRunProvider({ ...base, providerId: "censys" }).reason, /not a screen-stage/);
  assert.equal(
    shouldRunProvider({ ...base, providerId: "censys", researchStage: "deep", researchTriggered: true }).run,
    true,
  );
  assert.equal(
    shouldRunProvider({ ...base, providerId: "censys", researchStage: "deep", researchTriggered: true, targetSlug: "analytics" }).run,
    false,
  );

  // Tavily / PDL people gate on the research threshold in deep stage.
  const deep = { ...base, researchStage: "deep" as const };
  assert.equal(shouldRunProvider({ ...deep, providerId: "tavily", researchTriggered: false }).run, false);
  assert.match(
    shouldRunProvider({ ...deep, providerId: "tavily", researchTriggered: false }).reason,
    /threshold/,
  );
  assert.equal(shouldRunProvider({ ...deep, providerId: "pdl_people", researchTriggered: true }).run, true);

  // Unknown provider = no policy = no run.
  assert.equal(shouldRunProvider({ ...base, providerId: "mystery" }).run, false);
});

test("source priority order is highest-value first, first-party on top", async () => {
  const { sourcePriorityOrder } = await import("../src/lib/intel/policy");
  const order = sourcePriorityOrder();
  assert.equal(order[0], "customer_outcomes"); // first-party wins/losses
  assert.ok(order.indexOf("sec_edgar") < order.indexOf("builtwith_free")); // strategy > technographics
  assert.ok(order.indexOf("tavily") < order.indexOf("censys")); // corroboration > specialized
  assert.equal(order[order.length - 1], "common_crawl"); // historical research last
});

test("data completeness is per-category and separate from propensity (§24)", async () => {
  const { computeCompleteness } = await import("../src/lib/intel/completeness");
  // A hiring-only account: promising signal, but thinly researched.
  const thin = computeCompleteness({
    providersRun: new Set(["greenhouse"]),
    familiesPresent: new Set(["HIRING"]),
  });
  assert.equal(thin.byCategory.hiring, true);
  assert.equal(thin.byCategory.identity, false);
  assert.equal(thin.byCategory.people, false);
  assert.ok(thin.overall < 30);
  assert.ok(thin.gaps.includes("identity") && thin.gaps.includes("strategic"));

  // Broadly researched account scores high completeness.
  const broad = computeCompleteness({
    providersRun: new Set(["pdl_company", "sec_edgar", "greenhouse", "builtwith_free", "github", "pdl_people"]),
    familiesPresent: new Set(["STRATEGIC_CHANGE", "HIRING", "TECHNOLOGY", "COMMERCIAL_TIMING"]),
  });
  assert.ok(broad.overall >= 75);
  assert.equal(broad.byCategory.identity, true);

  // Evidence families satisfy a category even without the named provider.
  const viaFamily = computeCompleteness({
    providersRun: new Set(),
    familiesPresent: new Set(["ENGINEERING_ACTIVITY"]),
  });
  assert.equal(viaFamily.byCategory.engineering, true);
});

// -- GitHub (P1-A): engineering-momentum fixtures ------------------------

test("github: technology momentum over recent public repos", async () => {
  const { GithubProvider, computeGithubFeatures } = await import("../src/lib/intel/providers/github");
  const recent = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const snap = {
    org: "acme",
    repos: [
      { name: "terraform-modules", language: "HCL", pushed_at: recent(10), created_at: recent(200), archived: false, fork: false, topics: ["terraform", "iac"] },
      { name: "ansible-playbooks", language: "Python", pushed_at: recent(20), created_at: recent(300), archived: false, fork: false, topics: ["ansible", "automation"] },
      { name: "k8s-operators", language: "Go", pushed_at: recent(5), created_at: recent(40), archived: false, fork: false, topics: ["kubernetes"] },
      { name: "helm-charts", language: "Smarty", pushed_at: recent(15), created_at: recent(100), archived: false, fork: false, topics: ["helm", "kubernetes"] },
      { name: "old-thing", language: "Perl", pushed_at: recent(900), created_at: recent(1200), archived: true, fork: false, topics: [] },
      { name: "forked-lib", language: "Go", pushed_at: recent(2), created_at: recent(3), archived: false, fork: true, topics: ["kubernetes"] },
    ],
  };
  const f = computeGithubFeatures(snap, NOW);
  assert.equal(f.activeRepos, 4); // archived + fork excluded
  assert.equal(f.createdLast90d, 1); // only k8s-operators created in-window
  const k8s = f.byTechnology.find((t) => t.signalType === "KUBERNETES_ADOPTION_SIGNAL");
  assert.ok(k8s && k8s.repos === 2); // k8s-operators + helm-charts

  const provider = new GithubProvider();
  const candidates = provider.normalize(
    [{ payload: snap, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  const types = candidates.map((c) => c.suggestedSignalType);
  assert.ok(types.includes("KUBERNETES_ADOPTION_SIGNAL"));
  // Public activity, never an install claim.
  for (const c of candidates) {
    assert.equal(c.firstParty, false);
    assert.match(c.claim, /public GitHub org/);
    assert.ok(!/uses|installed|deployed internally/i.test(c.claim));
  }
  // Single-repo technology is noise (threshold gate).
  const thin = provider.normalize(
    [{ payload: { org: "acme", repos: [snap.repos[0]] }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: null },
  );
  assert.equal(thin.length, 0);
});

// -- SEC EDGAR (§4, §23): deterministic section identification -----------

test("sec: relevant-section extraction is keyword-driven and merges windows", async () => {
  const { relevantSections } = await import("../src/lib/intel/providers/sec");
  const filler = "lorem ipsum ".repeat(200);
  const text =
    filler +
    "The Company announced a multi-year infrastructure modernization and cloud migration program. " +
    filler +
    "Management initiated a cost reduction and restructuring effort to improve operating efficiency. " +
    filler;
  const sections = relevantSections(text);
  assert.ok(sections.length >= 2);
  assert.ok(sections.some((s) => /infrastructure modern|cloud migration/i.test(s)));
  assert.ok(sections.some((s) => /cost reduction|restructuring/i.test(s)));

  // No relevant keywords → nothing extracted → no LLM call downstream.
  assert.equal(relevantSections("lorem ipsum ".repeat(500)).length, 0);
});

test("sec provider: metadata and no-CIK absence behavior", async () => {
  const { SecProvider } = await import("../src/lib/intel/providers/sec");
  const p = new SecProvider();
  assert.equal(p.providerId, "sec_edgar");
  assert.equal(p.sourceTrustPrior, 0.9); // primary-source regulatory filings
  // No CIK handle = not a public company = absence, not error, no LLM call.
  assert.deepEqual(
    await p.fetch({ orgId: null, companyId: "c1", companyName: "Private LLC", domain: null }),
    [],
  );
});

// -- HTTP fingerprint (P0-G): deterministic header/HTML vendor detection --

test("http fingerprint: headers + scripts → conservative vendor evidence", async () => {
  const { HttpFingerprintProvider, fingerprintFrom } = await import(
    "../src/lib/intel/providers/http-fingerprint"
  );
  const headers = {
    server: "cloudflare",
    "cf-ray": "abc123",
    "x-powered-by": "ASP.NET",
  };
  const html = `<html><head><meta name="generator" content="HubSpot"></head>
    <body><script src="https://js.hs-scripts.com/123.js"></script>
    <script src="https://cdn.cloudfront.net/app.js"></script></body></html>`;
  const fp = fingerprintFrom("acme.com", headers, html);
  assert.ok(fp.vendors.includes("Cloudflare"));
  assert.ok(fp.vendors.includes("ASP.NET"));
  assert.ok(fp.vendors.includes("HubSpot"));
  assert.ok(fp.vendors.includes("AWS CloudFront"));
  assert.equal(fp.generator, "HubSpot");

  const provider = new HttpFingerprintProvider();
  const candidates = provider.normalize(
    [{ payload: fp, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  const cloud = candidates.find((c) => c.suggestedSignalType === "CLOUD_WEB_INFRASTRUCTURE_EVIDENCE");
  assert.ok(cloud);
  assert.match(cloud.claim, /HTTP fingerprint/);
  for (const c of candidates) assert.equal(c.firstParty, false); // supporting only

  // Change detection: vendor set changed vs the prior fingerprint.
  const prev = fingerprintFrom("acme.com", { server: "nginx" }, "");
  const withChange = provider.normalize(
    [{ payload: fp, isNew: true }],
    [{ payload: prev, observedAt: NOW }],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.ok(withChange.some((c) => c.suggestedSignalType === "WEB_INFRASTRUCTURE_CHANGE"));

  // No domain = absence.
  assert.deepEqual(
    await provider.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: null }),
    [],
  );
});

// -- Website monitor (P0-D): first-party metadata --------------------------

test("website provider: first-party posture and metadata", async () => {
  const { WebsiteProvider } = await import("../src/lib/intel/providers/website");
  const p = new WebsiteProvider();
  assert.equal(p.providerType, "FIRST_PARTY");
  assert.equal(p.sourceKind, "first_party");
  assert.equal(p.sourceTrustPrior, 0.8);
  // No domain = no fetch = absence, not error.
  assert.deepEqual(
    await p.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: null }),
    [],
  );
  // Unchanged pages are never sent to the LLM (isNew=false → skipped).
  const none = await p.normalize(
    [{ payload: { url: "https://acme.com/news", text: "x".repeat(500) }, isNew: false }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.deepEqual(none, []);
});

// -- People Data Labs (§3/§22): identity firmographics + gated people -------

test("pdl_company: firmographics are EVIDENCE only, never a propensity signal", async () => {
  const { PdlCompanyProvider } = await import("../src/lib/intel/providers/pdl");
  const p = new PdlCompanyProvider();
  assert.equal(p.providerId, "pdl_company");
  assert.equal(p.providerType, "FIRMOGRAPHIC");
  assert.deepEqual(p.supportedFamilies, ["COMPANY_FIT"]);

  const record = {
    name: "Acme", industry: "software", employeeCount: 4200, country: "US",
    region: "California", founded: 2010, ticker: "ACME", type: "public",
    summary: "Acme builds things.",
  };
  const candidates = p.normalize(
    [{ payload: { domain: "acme.com", record }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  // §3: size/industry establish FIT, never intent — so NO suggestedSignalType.
  assert.equal(c.suggestedSignalType, undefined);
  assert.match(c.claim, /firmographic profile/);
  assert.match(c.claim, /4,200 employees/);
  assert.match(c.claim, /publicly traded \(ACME\)/);
  assert.equal(c.firstParty, false);

  // Unchanged observation → no re-emitted evidence.
  const repeat = p.normalize(
    [{ payload: { domain: "acme.com", record }, isNew: false }],
    [{ payload: { domain: "acme.com", record }, observedAt: NOW }],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.deepEqual(repeat, []);

  // No key or no domain = SKIP_NO_DOMAIN (absence), never a fabricated firmographic.
  const savedKey = process.env.PDL_API_KEY;
  delete process.env.PDL_API_KEY;
  try {
    assert.deepEqual(
      await p.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
      [],
    );
  } finally {
    if (savedKey) process.env.PDL_API_KEY = savedKey;
  }
});

test("pdl_people: deep-only, targets the buying committee, degrades gracefully", async () => {
  const { PdlPeopleProvider } = await import("../src/lib/intel/providers/pdl");
  const p = new PdlPeopleProvider();
  assert.equal(p.providerId, "pdl_people");
  assert.equal(p.providerType, "PEOPLE");
  // Never runs in the universal cheap screen — credits are spent only after
  // an account crosses the research gate (§22).
  assert.equal(p.allowedForScreening, false);

  const people = [
    { fullName: "Dana Ops", jobTitle: "VP Platform Engineering", jobRole: "engineering" },
    { fullName: null, jobTitle: "CTO", jobRole: "engineering" }, // no name → dropped
  ];
  const candidates = p.normalize(
    [{ payload: { domain: "acme.com", people }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].claim, /Dana Ops holds VP Platform Engineering at Acme/);

  // No domain = absence, not error.
  assert.deepEqual(
    await p.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: null }),
    [],
  );
});

// -- GDELT corporate-event radar (P0-E) ------------------------------------

test("gdelt classifyEvent: subject-gated, specificity-ordered, event-typed", async () => {
  const { classifyEvent } = await import("../src/lib/intel/providers/gdelt");

  // Company as the subject of a launch → NEW_PRODUCT.
  assert.equal(classifyEvent("Acme launches new AI platform", "Acme")?.type, "NEW_PRODUCT");

  // A partner's event that only mentions the company is NOT attributed to it.
  assert.equal(classifyEvent("Datadog partners with Acme on observability", "Zscaler"), null);

  // Specificity: a new data center is a FACILITY, not a plain expansion.
  assert.equal(classifyEvent("MongoDB opens new data center in Frankfurt", "MongoDB")?.type, "NEW_FACILITY");
  // Acquisitions win over generic verbs.
  assert.equal(classifyEvent("MongoDB acquires Voyage AI to boost retrieval", "MongoDB")?.type, "M_AND_A");
  // Leadership changes.
  assert.equal(
    classifyEvent("Snowflake appoints new CTO to lead platform", "Snowflake")?.type,
    "NEW_TECHNOLOGY_LEADERSHIP",
  );
  // Partnerships.
  assert.equal(classifyEvent("Stripe teams up with Acme for payments", "Stripe")?.type, "PARTNERSHIP");

  // Non-events (stock chatter / tutorials) are rejected.
  assert.equal(classifyEvent("Datadog shares fall 16% as investors punish outlook", "Datadog"), null);
  assert.equal(classifyEvent("How to use MongoDB aggregation pipelines", "MongoDB"), null);
});

test("gdelt parseSeendate: compact timestamp round-trips, rejects junk", async () => {
  const { parseSeendate } = await import("../src/lib/intel/providers/gdelt");
  assert.equal(parseSeendate("20260806T161500Z")?.toISOString(), "2026-08-06T16:15:00.000Z");
  assert.equal(parseSeendate("not-a-date"), null);
  assert.equal(parseSeendate(""), null);
});

test("gdelt: radar-grade low-confidence evidence, new observations only", async () => {
  const { GdeltProvider } = await import("../src/lib/intel/providers/gdelt");
  const p = new GdeltProvider();
  assert.equal(p.providerId, "gdelt");
  assert.equal(p.costClass, "FREE");
  assert.equal(p.sourceTrustPrior, 0.4); // radar: low trust, needs corroboration

  // Force the deterministic path (no LLM) so the test is hermetic.
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const target = { orgId: null, companyId: "c1", companyName: "MongoDB", domain: "mongodb.com" };
    const ev = await p.normalize(
      [
        { payload: { url: "https://x.com/a", title: "MongoDB acquires Voyage AI", domain: "x.com", seendate: "20260806T161500Z" }, isNew: true },
        { payload: { url: "https://y.com/b", title: "MongoDB partners with AWS", domain: "y.com", seendate: "20260805T101500Z" }, isNew: true },
        { payload: { url: "https://z.com/c", title: "MongoDB stock rises on earnings", domain: "z.com", seendate: "20260804T101500Z" }, isNew: true }, // not an event
        { payload: { url: "https://w.com/d", title: "MongoDB launches Atlas Stream", domain: "w.com", seendate: "20260803T101500Z" }, isNew: false }, // not new
      ],
      [],
      target,
    );
    const types = ev.map((e) => e.suggestedSignalType).sort();
    assert.deepEqual(types, ["M_AND_A", "PARTNERSHIP"]); // event, event; non-event & non-new excluded
    for (const e of ev) {
      assert.equal(e.confidence, 0.45); // radar-grade
      assert.equal(e.firstParty, false);
      assert.match(e.claim, /News coverage indicates MongoDB/);
    }
  } finally {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
  }

  // No company name = no query = absence.
  assert.deepEqual(
    await p.fetch({ orgId: null, companyId: "c1", companyName: "", domain: "mongodb.com" }),
    [],
  );
});

// -- Generic careers monitor (P0-C): self-hosted / non-ATS boards ----------

test("careers extractJobPostings: JSON-LD JobPosting is the primary path", async () => {
  const { extractJobPostings } = await import("../src/lib/intel/providers/careers");
  const html = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"JobPosting","title":"Senior Platform Engineer","url":"/jobs/123","datePosted":"2026-07-01",
       "jobLocation":{"@type":"Place","address":{"addressLocality":"Berlin","addressCountry":"DE"}}},
      {"@type":"JobPosting","name":"Staff Kubernetes Engineer","url":"https://acme.com/jobs/456","datePosted":"2026-07-15"},
      {"@type":"WebPage","name":"Not a job"}
    ]}
    </script></head><body></body></html>`;
  const jobs = extractJobPostings(html, "https://acme.com/careers");
  assert.equal(jobs.length, 2);
  const platform = jobs.find((j) => j.title === "Senior Platform Engineer");
  assert.ok(platform);
  assert.equal(platform.url, "https://acme.com/jobs/123"); // relative resolved against base
  assert.equal(platform.location, "Berlin");
  assert.equal(platform.publishedAt?.toISOString().slice(0, 10), "2026-07-01");
  // Malformed JSON-LD in the same page never aborts extraction.
  const withJunk = extractJobPostings(
    `<script type="application/ld+json">{bad json}</script>` + html,
    "https://acme.com/careers",
  );
  assert.equal(withJunk.length, 2);
});

test("careers extractJobPostings: anchor fallback only without structured data", async () => {
  const { extractJobPostings } = await import("../src/lib/intel/providers/careers");
  const html = `<html><body>
    <a href="/careers/platform-engineer-eu">Platform Engineer, EU</a>
    <a href="/jobs/sre-lead">Site Reliability Engineer</a>
    <a href="/careers">View all openings</a>          <!-- generic, dropped -->
    <a href="/about">About us</a>                       <!-- not a job href -->
    <a href="/careers/apply">Apply now</a>              <!-- no title hint -->
  </body></html>`;
  const jobs = extractJobPostings(html, "https://acme.com/careers");
  const titles = jobs.map((j) => j.title).sort();
  assert.deepEqual(titles, ["Platform Engineer, EU", "Site Reliability Engineer"]);
  assert.equal(jobs[0].url?.startsWith("https://acme.com/"), true);
});

test("careers provider: shared hiring model, first-party, change-gated", async () => {
  const { CareersProvider } = await import("../src/lib/intel/providers/careers");
  const p = new CareersProvider();
  assert.equal(p.providerId, "careers");
  assert.equal(p.sourceKind, "first_party");

  // Enough relevant roles → hiring evidence via the SHARED model.
  const jobs = [
    { externalId: "c-1", title: "Platform Engineer", department: null, location: null, url: null, publishedAt: null },
    { externalId: "c-2", title: "Senior Platform Engineer", department: null, location: null, url: null, publishedAt: null },
    { externalId: "c-3", title: "Staff Platform Engineer", department: null, location: null, url: null, publishedAt: null },
  ];
  const ev = p.normalize(
    [{ payload: { url: "https://acme.com/careers", jobs }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.ok(ev.some((e) => e.suggestedSignalType === "PLATFORM_ENGINEERING_EXPANSION"));
  for (const e of ev) assert.equal(e.firstParty, true);

  // Unchanged snapshot (nothing new) = stop.
  assert.deepEqual(
    p.normalize(
      [{ payload: { url: "https://acme.com/careers", jobs }, isNew: false }],
      [{ payload: { url: "https://acme.com/careers", jobs }, observedAt: NOW }],
      { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
    ),
    [],
  );

  // No discovered board = no fetch = absence.
  assert.deepEqual(
    await p.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
    [],
  );
});

// -- Common Crawl historical change (P2-A) ---------------------------------

test("commoncrawl pathPrefix + strategicSegments: first segment, junk filtered", async () => {
  const { pathPrefix, strategicSegments } = await import("../src/lib/intel/providers/commoncrawl");
  assert.equal(pathPrefix("https://acme.com/careers/eng-123"), "careers");
  assert.equal(pathPrefix("https://acme.com/"), null); // root
  assert.equal(pathPrefix("https://acme.com/app.js"), null); // root-level asset
  assert.equal(pathPrefix("not a url"), null);

  const segs = strategicSegments([
    "https://acme.com/careers/1",
    "https://acme.com/partners",
    "https://acme.com/blog/x", // not strategic
    "https://acme.com/security/soc2",
  ]);
  assert.deepEqual([...segs].sort(), ["careers", "partners", "security"]);
});

test("commoncrawl addedSections + normalize: historical section appearance", async () => {
  const { addedSections, CommonCrawlProvider } = await import("../src/lib/intel/providers/commoncrawl");
  // partners + ai are new in recent; careers existed before → not "added".
  assert.deepEqual(addedSections(["careers", "partners", "ai"], ["careers"]), ["ai", "partners"]);

  const p = new CommonCrawlProvider();
  assert.equal(p.allowedForScreening, false); // deep-only
  assert.equal(p.sourceTrustPrior, 0.5);
  const ev = p.normalize(
    [{
      payload: {
        domain: "acme.com",
        recent: { crawl: "CC-MAIN-2026-30", paths: ["careers", "partners", "ai"], count: 120 },
        older: { crawl: "CC-MAIN-2025-30", paths: ["careers"], count: 90 },
      },
      isNew: true,
    }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  // ai → AI_INITIATIVE (mapped); partners → PARTNERSHIP; careers unchanged → none.
  const signals = ev.map((e) => e.suggestedSignalType).sort();
  assert.deepEqual(signals, ["AI_INITIATIVE", "PARTNERSHIP"]);
  for (const e of ev) {
    assert.equal(e.confidence, 0.55);
    assert.match(e.claim, /Common Crawl history shows Acme added/);
    assert.match(e.claim, /CC-MAIN-2026-30.*CC-MAIN-2025-30/);
  }

  // No new sections → no evidence (nothing changed historically).
  assert.deepEqual(
    p.normalize(
      [{ payload: { domain: "acme.com", recent: { crawl: "a", paths: ["careers"], count: 10 }, older: { crawl: "b", paths: ["careers"], count: 10 } }, isNew: true }],
      [],
      { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
    ),
    [],
  );
});

// -- Tavily deep-research provider + investigator ---------------------------

test("tavily investigationQuery: strips radar framing, targets the event", async () => {
  const { investigationQuery } = await import("../src/lib/intel/providers/tavily");

  const gdelt = investigationQuery(
    "MongoDB",
    'News coverage indicates MongoDB launched a product or initiative: "MongoDB launches Atlas Stream" (techcrunch.com)',
  );
  assert.ok(gdelt.startsWith('"MongoDB"'));
  assert.ok(!/news coverage indicates/i.test(gdelt)); // radar framing removed
  assert.ok(!gdelt.includes('"MongoDB launches')); // inner quotes stripped

  const cc = investigationQuery(
    "Acme",
    "Common Crawl history shows Acme added a partners section (present in crawl CC-MAIN-2026-30, absent in CC-MAIN-2025-30)",
  );
  assert.ok(!/common crawl history shows/i.test(cc));
  assert.ok(!/present in crawl/i.test(cc));
  assert.ok(cc.includes("partners section"));
});

test("tavily provider: deep-only, credit-gated, absent without a key", async () => {
  const { TavilyProvider } = await import("../src/lib/intel/providers/tavily");
  const p = new TavilyProvider();
  assert.equal(p.providerId, "tavily");
  assert.equal(p.allowedForScreening, false); // never the cheap screen
  assert.equal(p.sourceTrustPrior, 0.6); // secondary web research

  const savedKey = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    // No key → no fetch, no fabricated research.
    assert.deepEqual(
      await p.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
      [],
    );
  } finally {
    if (savedKey) process.env.TAVILY_API_KEY = savedKey;
  }

  // Unchanged observations → nothing re-derived.
  const none = await p.normalize(
    [{ payload: { query: "q", title: "t", url: "https://x.com", content: "..." }, isNew: false }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.deepEqual(none, []);
});
