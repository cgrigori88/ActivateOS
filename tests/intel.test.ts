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
