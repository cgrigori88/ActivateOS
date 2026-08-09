import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  extractThreadAlias,
  generateThreadAlias,
  isThreadAlias,
  threadAddress,
} from "../src/lib/comms/alias";
import {
  normalizeSubject,
  participantsSubjectKey,
  resolveThread,
  type ThreadCandidateIndex,
} from "../src/lib/comms/threading";
import { editDistance, stripQuoted } from "../src/lib/comms/text";
import { verifyWebhookSignature } from "../src/lib/comms/resend";
import type { InboundMessage } from "../src/lib/comms/provider";

const DOMAIN = "threads.pursuitos.io";

test("thread aliases: generate, validate, address, extract", () => {
  const alias = generateThreadAlias();
  assert.ok(isThreadAlias(alias), alias);
  assert.ok(alias.startsWith("m_"));
  assert.equal(threadAddress(alias, DOMAIN), `${alias}@${DOMAIN}`);

  // Bare, plus-addressed, and display-name forms all extract.
  assert.equal(extractThreadAlias([`${alias}@${DOMAIN}`], DOMAIN), alias);
  assert.equal(extractThreadAlias([`thread+${alias}@${DOMAIN}`], DOMAIN), alias);
  assert.equal(extractThreadAlias([`"Cap" <${alias}@${DOMAIN}>`], DOMAIN), alias);
  // Wrong domain never matches.
  assert.equal(extractThreadAlias([`${alias}@other.com`], DOMAIN), null);
  assert.equal(extractThreadAlias(["random@customer.com"], DOMAIN), null);
});

function inbound(overrides: Partial<InboundMessage>): InboundMessage {
  return {
    providerMessageId: null,
    internetMessageId: "<new@customer.com>",
    inReplyTo: null,
    references: [],
    from: { name: "Jane", email: "jane@customer.com" },
    to: ["dana@engage.pursuitos.io"],
    cc: [],
    subject: "Re: Automation assessment",
    textBody: "reply",
    htmlBody: null,
    receivedAt: new Date("2026-08-09T00:00:00Z"),
    attachmentCount: 0,
    rawHeaders: {},
    ...overrides,
  };
}

test("thread matching hierarchy: alias beats headers beats participants", () => {
  const index: ThreadCandidateIndex = {
    byAlias: new Map([["m_abcdefghjk", "t-alias"]]),
    byInternetMessageId: new Map([["<orig@pursuitos>", "t-header"]]),
    byProviderMessageId: new Map([["prov-1", "t-provider"]]),
    byParticipantsSubject: new Map([
      [
        participantsSubjectKey(
          ["jane@customer.com", "dana@engage.pursuitos.io"],
          "Automation assessment",
        ),
        "t-participants",
      ],
    ]),
  };

  // 1. Alias wins even when headers also match.
  const withAlias = resolveThread(
    inbound({ cc: [`m_abcdefghjk@${DOMAIN}`], inReplyTo: "<orig@pursuitos>" }),
    index,
    DOMAIN,
  );
  assert.deepEqual(withAlias, { threadId: "t-alias", matchedBy: "alias" });

  // 2. In-Reply-To next.
  const withHeader = resolveThread(inbound({ inReplyTo: "<orig@pursuitos>" }), index, DOMAIN);
  assert.deepEqual(withHeader, { threadId: "t-header", matchedBy: "in_reply_to" });

  // 3. References fallback.
  const withRefs = resolveThread(
    inbound({ references: ["<unknown@x>", "<orig@pursuitos>"] }),
    index,
    DOMAIN,
  );
  assert.deepEqual(withRefs, { threadId: "t-header", matchedBy: "references" });

  // 5. Participants + normalized subject ("Re:" stripped).
  const byParticipants = resolveThread(inbound({}), index, DOMAIN);
  assert.deepEqual(byParticipants, {
    threadId: "t-participants",
    matchedBy: "participants_subject",
  });

  // 6. Nothing matches → null → human triage.
  assert.equal(
    resolveThread(inbound({ subject: "Completely different", to: ["x@y.com"] }), index, DOMAIN),
    null,
  );
});

test("subject normalization strips reply/forward prefixes", () => {
  assert.equal(normalizeSubject("Re: RE: Fwd: Hello  world"), "hello world");
  assert.equal(normalizeSubject(null), "");
});

test("stripQuoted removes quoted history and signatures", () => {
  const body = [
    "Thanks — we're reviewing our virtualization options this quarter.",
    "",
    "Best,",
    "Jane",
    "-- ",
    "Jane Smith | VP Infrastructure",
    "On Aug 8, 2026, Dana Whitfield wrote:",
    "> Original outreach text",
    "> More quoted text",
  ].join("\n");
  const stripped = stripQuoted(body);
  assert.ok(stripped.includes("reviewing our virtualization options"));
  assert.ok(!stripped.includes("Original outreach"));
  assert.ok(!stripped.includes("VP Infrastructure"));
});

test("editDistance measures seller edits", () => {
  assert.equal(editDistance("same", "same"), 0);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
});

test("webhook signature verification (svix scheme)", () => {
  const secretRaw = Buffer.from("test-secret-key-32-bytes-long!!!");
  const secret = `whsec_${secretRaw.toString("base64")}`;
  const id = "msg_1";
  const now = new Date("2026-08-09T00:00:00Z");
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const rawBody = '{"type":"email.received"}';
  const sig = createHmac("sha256", secretRaw)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  const ok = verifyWebhookSignature({
    secret, id, timestamp, rawBody, signatureHeader: `v1,${sig}`, now,
  });
  assert.equal(ok, true);

  // Tampered body fails; stale timestamp fails.
  assert.equal(
    verifyWebhookSignature({
      secret, id, timestamp, rawBody: "{}", signatureHeader: `v1,${sig}`, now,
    }),
    false,
  );
  assert.equal(
    verifyWebhookSignature({
      secret, id, timestamp, rawBody, signatureHeader: `v1,${sig}`,
      now: new Date(now.getTime() + 10 * 60 * 1000),
    }),
    false,
  );
});

test("zoneRelativeName maps Resend record names into the apex zone", async () => {
  const { zoneRelativeName } = await import("../scripts/setup-comms-dns");
  const apex = "pursuitos.io";
  // Resend gives names relative to ITS domain (engage.pursuitos.io).
  assert.equal(zoneRelativeName("send", "engage.pursuitos.io", apex), "send.engage");
  assert.equal(
    zoneRelativeName("resend._domainkey", "engage.pursuitos.io", apex),
    "resend._domainkey.engage",
  );
  // Apex-of-subdomain records (e.g. inbound MX on threads.pursuitos.io).
  assert.equal(zoneRelativeName("threads.pursuitos.io", "threads.pursuitos.io", apex), "threads");
  // Fully-qualified name form.
  assert.equal(
    zoneRelativeName("send.engage.pursuitos.io", "engage.pursuitos.io", apex),
    "send.engage",
  );
});
