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

test("builtwith baseline: only ontology-mapped technologies become evidence", async () => {
  const { BuiltWithProvider, extractTechnologies } = await import(
    "../src/lib/intel/providers/builtwith"
  );
  const fixture = {
    Results: [
      {
        Lookup: "acme.com",
        Result: {
          Paths: [
            {
              Technologies: [
                { Name: "Kubernetes", Tag: "hosting", Categories: ["Container Orchestration"] },
                { Name: "Google Analytics", Tag: "analytics" }, // unmapped → skipped
                { Name: "Ansible", Tag: "hosting" },
              ],
            },
          ],
        },
      },
    ],
  };
  assert.equal(extractTechnologies(fixture).length, 3);

  const provider = new BuiltWithProvider();
  const candidates = provider.normalize(
    [
      {
        payload: {
          mode: "baseline",
          domain: "acme.com",
          technologies: extractTechnologies(fixture),
        },
        isNew: true,
      },
    ],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  // Kubernetes + Ansible map into the ontology; Google Analytics does not.
  assert.equal(candidates.length, 2);
  for (const c of candidates) {
    assert.match(c.claim, /public web presence/); // web-facing phrasing, never installed-base proof
    assert.equal(c.suggestedSignalType, "TECH_INSTALLED");
    assert.ok(c.suggestedNodeSlug);
  }
});

test("builtwith changes: additions/removals/stack-change signals", async () => {
  const { BuiltWithProvider, extractChanges } = await import(
    "../src/lib/intel/providers/builtwith"
  );
  const fixture = {
    Lookup: "acme.com",
    Changes: [
      { Technology: "Ansible", Type: "Added", Date: "2026-07-20" },
      { Technology: "VMware", Type: "Removed", Date: "2026-07-22" },
    ],
  };
  const changes = extractChanges(fixture);
  assert.deepEqual(changes.map((c) => c.type), ["added", "removed"]);

  const provider = new BuiltWithProvider();
  const candidates = provider.normalize(
    [{ payload: { mode: "change", domain: "acme.com", changes }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.equal(candidates.length, 2); // <5 changes → no stack-change event
  assert.equal(candidates[0].suggestedSignalType, "TECHNOLOGY_ADDED");
  assert.equal(candidates[1].suggestedSignalType, "TECH_REMOVED");

  // ≥5 simultaneous changes add a TECHNOLOGY_STACK_CHANGE event.
  const many = Array.from({ length: 6 }, (_, i) => ({
    name: `Tech${i}`, type: "added" as const, date: null,
  }));
  const withStack = provider.normalize(
    [{ payload: { mode: "change", domain: "acme.com", changes: many }, isNew: true }],
    [],
    { orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" },
  );
  assert.ok(withStack.some((c) => c.suggestedSignalType === "TECHNOLOGY_STACK_CHANGE"));
});

test("builtwith disabled/absent states: no key or no domain = absence, not error", async () => {
  const { BuiltWithProvider } = await import("../src/lib/intel/providers/builtwith");
  const provider = new BuiltWithProvider();
  const saved = process.env.BUILTWITH_API_KEY;
  delete process.env.BUILTWITH_API_KEY;
  try {
    assert.deepEqual(
      await provider.fetch({ orgId: null, companyId: "c1", companyName: "Acme", domain: "acme.com" }),
      [],
    );
    const health = await provider.healthCheck();
    assert.equal(health.ok, false);
    assert.match(health.detail, /not set/);
  } finally {
    if (saved) process.env.BUILTWITH_API_KEY = saved;
  }
  // Metered guard is declared: weekly per-company throttle.
  assert.equal(provider.minRefreshHours, 24 * 7);
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
  assert.ok(order.indexOf("sec_edgar") < order.indexOf("builtwith")); // strategy > technographics
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
    providersRun: new Set(["pdl_company", "sec_edgar", "greenhouse", "builtwith", "github", "pdl_people"]),
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
