import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, normalizeTz, zonedToUtc } from "../src/lib/comms/tz";

test("zonedToUtc: Eastern daylight vs standard (DST-correct)", () => {
  // July → EDT (UTC-4): 09:00 local = 13:00 UTC
  assert.equal(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z");
  // January → EST (UTC-5): 09:00 local = 14:00 UTC
  assert.equal(zonedToUtc("2026-01-01", "09:00", "America/New_York").toISOString(), "2026-01-01T14:00:00.000Z");
});

test("zonedToUtc: Pacific offset", () => {
  // July → PDT (UTC-7): 09:00 local = 16:00 UTC
  assert.equal(zonedToUtc("2026-07-01", "09:00", "America/Los_Angeles").toISOString(), "2026-07-01T16:00:00.000Z");
});

test("addDays: crosses month boundary", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-12-31", 3), "2027-01-03");
  assert.equal(addDays("2026-03-01", 0), "2026-03-01");
});

test("normalizeTz: unknown falls back to Eastern", () => {
  assert.equal(normalizeTz("Mars/Olympus"), "America/New_York");
  assert.equal(normalizeTz(null), "America/New_York");
  assert.equal(normalizeTz("UTC"), "UTC");
});
