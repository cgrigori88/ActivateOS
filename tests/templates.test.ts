import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBrandedEmail, renderPlainText, type EmailBrand } from "../src/lib/comms/templates";

const BRAND: Partial<EmailBrand> = {
  wordmark: "Acme Partners",
  primaryColor: "#7c3aed",
  accentColor: "#111827",
  addressLine: "1 Market St, SF",
  unsubscribeUrl: "https://x.test/unsub",
};

test("renderBrandedEmail: brand tokens land in the HTML", () => {
  const { html } = renderBrandedEmail(BRAND, {
    headline: "Your Kafka footprint just grew",
    paragraphs: ["We noticed three new brokers in your job posts."],
    ctaLabel: "Book 20 minutes",
    ctaUrl: "https://x.test/book",
  });
  assert.match(html, /Acme Partners/);
  assert.match(html, /#7c3aed/); // primary color on the CTA
  assert.match(html, /#111827/); // accent band
  assert.match(html, /Book 20 minutes/);
  assert.match(html, /https:\/\/x\.test\/book/);
  assert.match(html, /https:\/\/x\.test\/unsub/);
});

test("renderBrandedEmail: escapes user content, no raw injection", () => {
  const { html } = renderBrandedEmail(BRAND, {
    headline: "<script>alert(1)</script>",
    paragraphs: ['quote " and <b>tag</b>'],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderBrandedEmail: invalid hex falls back to default", () => {
  const { html } = renderBrandedEmail(
    { primaryColor: "not-a-color" },
    { paragraphs: ["hi"], ctaLabel: "Go", ctaUrl: "https://x.test" },
  );
  assert.match(html, /#1d4ed8/); // default primary on the CTA
});

test("renderBrandedEmail: CTA label without URL renders as text, not a broken link", () => {
  const { html } = renderBrandedEmail(BRAND, { paragraphs: ["hi"], ctaLabel: "Reply to chat" });
  assert.match(html, /Reply to chat/);
  assert.doesNotMatch(html, /<a href="[^"]*">Reply to chat/);
});

test("renderPlainText: mirrors content without markup", () => {
  const brand: EmailBrand = { wordmark: "Acme", primaryColor: "#000", accentColor: "#000", unsubscribeUrl: "https://x.test/u" };
  const text = renderPlainText(brand, {
    headline: "Hello",
    paragraphs: ["First.", "Second."],
    highlights: ["Point A"],
    ctaLabel: "Book",
    ctaUrl: "https://x.test/b",
    signoff: "Dana",
  });
  assert.doesNotMatch(text, /</);
  assert.match(text, /Hello/);
  assert.match(text, /- Point A/);
  assert.match(text, /Book: https:\/\/x\.test\/b/);
  assert.match(text, /Dana/);
});
