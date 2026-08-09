import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractDomain,
  nameSimilarity,
  normalizeCompanyName,
} from "../src/lib/identity/normalize";
import { resolveCompany } from "../src/lib/identity/resolve";

test("normalizeCompanyName strips punctuation and legal suffixes", () => {
  assert.equal(normalizeCompanyName("Acme Corp., Inc."), "acme");
  assert.equal(normalizeCompanyName("Globex Manufacturing Inc."), "globex manufacturing");
  assert.equal(normalizeCompanyName("Stark Industries LLC"), "stark industries");
  assert.equal(normalizeCompanyName("The Company Store"), "the company store");
  assert.equal(normalizeCompanyName("Müller & Sons GmbH"), "müller and sons");
});

test("normalizeCompanyName keeps a lone suffix-word name", () => {
  assert.equal(normalizeCompanyName("Limited"), "limited");
});

test("extractDomain handles urls, emails, and hosts", () => {
  assert.equal(extractDomain("https://www.acme.com/products"), "acme.com");
  assert.equal(extractDomain("jane@acme.co.uk"), "acme.co.uk");
  assert.equal(extractDomain("ACME.COM"), "acme.com");
  assert.equal(extractDomain("not a domain"), null);
  assert.equal(extractDomain(""), null);
});

test("nameSimilarity scores token overlap", () => {
  assert.equal(nameSimilarity("Acme Corp", "Acme Inc"), 1);
  assert.ok(nameSimilarity("Globex Manufacturing", "Globex Mfg Holdings") < 1);
  assert.equal(nameSimilarity("Acme", "Initech"), 0);
});

const candidates = [
  { id: "c1", normalizedName: "globex manufacturing", primaryDomain: "globex.example.com", country: "US" },
  { id: "c2", normalizedName: "initech financial", primaryDomain: "initech.example.com", country: "US" },
  { id: "c3", normalizedName: "stark industries advanced weapons", primaryDomain: null, country: "US" },
];

test("resolveCompany prefers exact domain", () => {
  const r = resolveCompany(
    { name: "Totally Different Name", domain: "globex.example.com" },
    candidates,
  );
  assert.equal(r?.companyId, "c1");
  assert.equal(r?.method, "exact_domain");
});

test("resolveCompany falls back to normalized name", () => {
  const r = resolveCompany({ name: "Initech Financial Inc." }, candidates);
  assert.equal(r?.companyId, "c2");
  assert.equal(r?.method, "normalized_name");
});

test("resolveCompany treats a stripped legal suffix as an exact name match", () => {
  const r = resolveCompany({ name: "Globex Manufacturing Group" }, candidates);
  assert.equal(r?.companyId, "c1");
  assert.equal(r?.method, "normalized_name");
});

test("resolveCompany fuzzy-matches close names", () => {
  const r = resolveCompany({ name: "Stark Industries Advanced Weapons Division" }, candidates);
  assert.equal(r?.companyId, "c3");
  assert.equal(r?.method, "fuzzy_name");
});

test("resolveCompany returns null for unknown companies", () => {
  assert.equal(resolveCompany({ name: "Wayne Enterprises" }, candidates), null);
});
