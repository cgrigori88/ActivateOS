/**
 * CFR-1.2 — the standing certification crawl. Previously reconstructed from session scratch each
 * time, which is how it silently drifted away from the application it certifies; it lives here now.
 *
 *   npx tsx scripts/cfr12-crawl.ts --preflight
 *   npx tsx scripts/cfr12-crawl.ts --out /tmp/crawl.json
 *   npx tsx scripts/cfr12-crawl.ts --out /tmp/crawl.json --rooms baseline   # the accepted P2 set
 *   npx tsx scripts/cfr12-crawl.ts --compare <baseline.json> <subject.json>
 *
 * INPUTS (env, never printed): CRAWL_BASE · VERCEL_AUTOMATION_BYPASS_SECRET · GATE_DEMO_EMAIL ·
 * GATE_DEMO_PASSWORD · OPS_FINGERPRINT_TOKEN. Optional: EXPECT_COMMIT, EXPECT_BRANCH.
 *
 * WHAT IT REFUSES TO DO. It will not report a result it cannot stand behind: if the deployment is
 * not the expected Preview/demo one, if a sign-in yields no session, if a protected room answers
 * with the sign-in representation while supposedly authenticated, if a protected room is reachable
 * anonymously, or if the room inventory cannot be resolved from rendered links — the run is
 * **INVALID** and exits non-zero. INVALID is not FAIL and it is certainly not PASS.
 *
 * THROTTLE AWARENESS. Sign-in is rate-limited per IP (10 / 5 min) and PER EMAIL (10 / 15 min), both
 * fixed-window. A throttled attempt still answers 303 — it redirects to /login?error=… with no
 * cookie — so the only safe test is the cookie plus an authenticated render. This run spends
 * exactly TWO sign-ins (one per independent session); it never retries in a loop.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { classifyRoom, looksUnauthenticated, normalizeLines, redact, verdictFor, type RoomRender } from "./cfr12-lib";

const PREVIEW_REF = "mejokqxriwyawfhawuxu";
const PRODUCTION_REF = "qifatlqxfuhwrwvpbwsc";
const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

const BASE = (process.env.CRAWL_BASE ?? "").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const EMAIL = (process.env.GATE_DEMO_EMAIL ?? "").trim().toLowerCase();
const PASSWORD = process.env.GATE_DEMO_PASSWORD ?? "";
const OPS = process.env.OPS_FINGERPRINT_TOKEN ?? "";
const SECRETS = [BYPASS, PASSWORD, OPS, process.env.DATABASE_URL];
const say = (s: string) => console.log(redact(s, SECRETS));
const invalid = (why: string): never => { say(`\nRUN INVALID — ${why}`); say("INVALID is not FAIL and is not PASS: no certification result is produced."); process.exit(3); };

const baseHeaders = () => ({ "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "false" });

/**
 * Every request goes through here. A transport failure — DNS, TLS, timeout, a deployment that is
 * not there — is a condition the run could not establish, so it is INVALID. It must never surface
 * as an unhandled rejection, because a stack trace is not a certification verdict.
 */
async function dial(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const why = (e as Error & { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? "unknown transport error";
    return invalid(`could not reach the deployment (${redact(String(why), SECRETS)})`);
  }
}

process.on("unhandledRejection", (e) => invalid(`unhandled error during the run: ${redact(String((e as Error)?.message ?? e), SECRETS)}`));
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

class Jar {
  private c = new Map<string, string>();
  absorb(res: Response): void {
    for (const sc of (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      if (i > 0) {
        const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
        if (v === "" || /Max-Age=0/i.test(sc)) this.c.delete(k); else this.c.set(k, v);
      }
    }
  }
  header(): string { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  get size(): number { return this.c.size; }
  /** A Supabase session cookie, not merely "some cookie". */
  get hasSession(): boolean { return [...this.c.keys()].some((k) => /^sb-.*-auth-token/.test(k)); }
}

async function get(jar: Jar | null, room: string): Promise<{ status: number; location: string | null; lines: string[]; raw: string }> {
  const res = await dial(BASE + room, {
    headers: { ...baseHeaders(), ...(jar && jar.size ? { Cookie: jar.header() } : {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  jar?.absorb(res);
  const raw = await res.text();
  const isApi = room.startsWith("/api/") || room.startsWith("/accounts/export");
  return { status: res.status, location: res.headers.get("location"), lines: isApi ? raw.split("\n") : normalizeLines(raw), raw };
}

/**
 * Sign in the way a browser without JavaScript does: the hidden `$ACTION_ID_<id>` field and NO
 * `Next-Action` header. Sending that header makes Next 16.3 decode the body as an RSC reply stream,
 * which fails on a hand-built multipart payload with a 500 — a harness fault that cost the P6-IG
 * gate a STOP by looking exactly like a schema incompatibility.
 */
async function signIn(jar: Jar): Promise<{ status: number; session: boolean }> {
  const page = await dial(`${BASE}/login`, { headers: baseHeaders(), redirect: "manual" });
  jar.absorb(page);
  const actionId = (await page.text()).match(/\$ACTION_ID_([a-f0-9]+)/)?.[1];
  if (!actionId) invalid("no server-action id on /login — the sign-in surface did not render");
  const B = "----cfr12" + Math.random().toString(36).slice(2);
  const part = (n: string, v: string) => `--${B}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
  const res = await dial(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...baseHeaders(),
      "Content-Type": `multipart/form-data; boundary=${B}`,
      Accept: "text/html,application/xhtml+xml",
      Origin: new URL(BASE).origin,
      Referer: `${BASE}/login`,
      ...(jar.size ? { Cookie: jar.header() } : {}),
    },
    body: part(`$ACTION_ID_${actionId}`, "") + part("email", EMAIL) + part("password", PASSWORD) + `--${B}--\r\n`,
  });
  jar.absorb(res);
  const body = await res.text();
  // A throttled sign-in also answers 303 — to /login?error=… — so the redirect target is evidence.
  const throttled = /Too many attempts/i.test(body) || (res.headers.get("location") ?? "").includes("error=");
  if (throttled) invalid("sign-in was REFUSED BY THE THROTTLE (per-IP 10/5min, per-email 10/15min). Wait for the fixed window to reset; do not retry in a loop.");
  return { status: res.status, session: jar.hasSession };
}

/** Room ids come from what the application actually renders, never from a guessed route shape. */
async function resolveRooms(jar: Jar): Promise<{ rooms: string[]; picks: Record<string, string> }> {
  const pickFrom = async (index: string, patterns: RegExp[], label: string): Promise<string> => {
    const { raw, status } = await get(jar, index);
    if (status !== 200) invalid(`${label}: index ${index} answered ${status} while authenticated`);
    for (const re of patterns) {
      const hit = [...raw.matchAll(re)].map((m) => m[1]).find(Boolean);
      if (hit) return hit;
    }
    // Explicit failure. The old resolver matched `/accounts/<uuid>`, which the accounts list does
    // not emit — it links `?sel=<uuid>` — so it resolved only on incidental prefetch entries and
    // produced a room set nobody had verified. Never guess; say the link contract changed.
    return invalid(`${label}: no id-bearing link matched on ${index}. The rendered link contract has changed — update the pattern deliberately rather than letting discovery drift.`);
  };
  const href = (p: string) => new RegExp(`href="${p}"`, "g");
  const account = await pickFrom("/accounts", [href(`/accounts\\?sel=${UUID}`), href(`/accounts/${UUID}`)], "account");
  const contact = await pickFrom("/contacts", [href(`/contacts/${UUID}`)], "contact");
  const hero = await pickFrom("/pursuits", [href(`/pursuits/${UUID}`)], "pursuit");
  const motion = await pickFrom("/motions", [href(`/briefs/${UUID}`), href(`/motions\\?mdrawer=${UUID}[^"]*`)], "motion");
  const goal = await pickFrom("/goals", [href(`/goals/${UUID}`)], "goal");
  const partner = await pickFrom("/partners", [href(`/partners/${UUID}`)], "partner");
  const joint = await pickFrom("/joint", [href(`/joint/${UUID}`)], "joint");
  return { picks: { account, contact, hero, motion, goal, partner, joint }, rooms: roomsFor({ account, contact, hero, motion, goal, partner, joint }) };
}

/** The certified 37-room inventory. Unchanged from the accepted P2/P45 records. */
function roomsFor(p: Record<string, string>): string[] {
  return [
    "/", "/?today=all", `/?drawer=${p.account}`, "/queue", "/pipeline", "/accounts", `/accounts/${p.account}`, "/accounts/export",
    "/contacts", `/contacts/${p.contact}`, "/mapping", "/pursuits", `/pursuits/${p.hero}`, "/motions", `/briefs/${p.motion}`, "/goals",
    `/goals/${p.goal}`, "/campaigns", "/upcoming", "/analytics", "/insights", "/review", "/sources", "/provider-health", "/partners",
    `/partners/${p.partner}`, `/partners/${p.partner}/review`, "/joint", `/joint/${p.joint}`, "/skills", "/routines", "/admin", "/ops",
    "/ask", "/trust", "/intake", "/api/palette?q=Globex",
  ];
}

const EXPECTED_ROOM_CLASSES = ["account", "contact", "hero", "motion", "goal", "partner", "joint"];

/** Everything that must be true before a single room is counted. */
async function preflight(jar: Jar): Promise<{ picks: Record<string, string>; rooms: string[]; build: Record<string, unknown> }> {
  if (!BASE) invalid("CRAWL_BASE is not set");
  if (!BYPASS || !EMAIL || !PASSWORD) invalid("a required input is absent (bypass / demo email / demo password)");

  say("=== PREFLIGHT");
  const res = await dial(`${BASE}/api/build`, { headers: { ...baseHeaders(), "x-ops-token": OPS } });
  if (res.status !== 200) invalid(`/api/build answered ${res.status} — the deployment identity could not be established (ops token? protection bypass?)`);
  const build = await res.json().catch(() => invalid("/api/build did not return JSON")) as Record<string, any>;
  say(`  deployment: commit ${build.commitShort} · branch ${build.branch} · ${build.vercelEnv}/${build.environment} · db ${build.database?.projectRef} · role ${build.database?.role}`);
  if (build.vercelEnv !== "preview" || build.environment !== "demo") invalid(`not the Preview/demo deployment (${build.vercelEnv}/${build.environment})`);
  if (build.database?.projectRef === PRODUCTION_REF) invalid("the deployment names the PRODUCTION project");
  if (build.database?.projectRef !== PREVIEW_REF) invalid(`unexpected database project ref ${build.database?.projectRef}`);
  if (build.database?.role !== "app_rw") invalid(`runtime database role is ${build.database?.role}, not app_rw`);
  if (process.env.EXPECT_BRANCH && build.branch !== process.env.EXPECT_BRANCH) invalid(`branch ${build.branch} ≠ expected ${process.env.EXPECT_BRANCH}`);
  if (process.env.EXPECT_COMMIT && build.commitShort !== process.env.EXPECT_COMMIT) invalid(`commit ${build.commitShort} ≠ expected ${process.env.EXPECT_COMMIT}`);

  // A protected room must be UNREACHABLE anonymously — otherwise "authenticated content" proves nothing.
  const anon = await get(null, "/queue");
  if (!looksUnauthenticated(anon.status, anon.location, anon.lines)) invalid(`/queue did not present the anonymous representation without a session (status ${anon.status})`);
  say(`  anonymous /queue → ${anon.status} ${anon.location ?? ""} (correctly gated)`);

  const { status, session } = await signIn(jar);
  if (!session) invalid(`sign-in returned ${status} but produced NO session cookie — 303 alone is not authentication`);
  say(`  sign-in → ${status} with a session cookie`);

  // …and the same room must now render authenticated content, not the sign-in page.
  const authed = await get(jar, "/queue");
  if (authed.status !== 200) invalid(`/queue answered ${authed.status} while authenticated`);
  if (looksUnauthenticated(authed.status, authed.location, authed.lines)) invalid("/queue rendered the sign-in representation while supposedly authenticated");
  say(`  authenticated /queue → 200, ${authed.lines.length} rendered lines`);

  const { picks, rooms } = process.env.CFR12_ROOMS === "baseline" ? baselineRooms() : await resolveRooms(jar);
  const missing = EXPECTED_ROOM_CLASSES.filter((c) => !picks[c]);
  if (missing.length) invalid(`room inventory incomplete — unresolved classes: ${missing.join(", ")}`);
  if (rooms.length !== 37) invalid(`room inventory is ${rooms.length}, expected the certified 37`);
  say(`  rooms resolved: ${rooms.length}, all ${EXPECTED_ROOM_CLASSES.length} classes present`);
  return { picks, rooms, build };
}

/** The accepted P2-closeout ids, for comparisons that must use the historical room set. */
function baselineRooms(): { picks: Record<string, string>; rooms: string[] } {
  const picks = JSON.parse(readFileSync(new URL("./cfr12-baseline-rooms.json", import.meta.url), "utf8")) as Record<string, string>;
  return { picks, rooms: roomsFor(picks) };
}

async function pass(jar: Jar, rooms: string[]): Promise<Record<string, RoomRender>> {
  const out: Record<string, RoomRender> = {};
  for (const room of rooms) {
    const g = await get(jar, room);
    if (looksUnauthenticated(g.status, g.location, g.lines)) invalid(`room ${room} fell back to the anonymous representation mid-crawl — the session was lost; no partial result is reported`);
    out[room] = { status: g.status, lines: g.lines };
  }
  return out;
}

async function crawl(outPath: string): Promise<void> {
  const jar1 = new Jar();
  const { picks, rooms, build } = await preflight(jar1);

  say("\n=== SESSION 1");
  const c1p1 = await pass(jar1, rooms);
  const c1p2 = await pass(jar1, rooms);

  say("=== SESSION 2 (independent login)");
  const jar2 = new Jar();
  const s2 = await signIn(jar2);
  if (!s2.session) invalid(`the second session returned ${s2.status} but produced NO session cookie — two independent authenticated sessions are required`);
  const c2p1 = await pass(jar2, rooms);
  const c2p2 = await pass(jar2, rooms);

  const passes = { c1p1, c1p2, c2p1, c2p2 };
  const digests = Object.fromEntries(Object.entries(passes).map(([k, v]) => [k, sha(v)]));
  say("\n=== DETERMINISM");
  for (const [k, d] of Object.entries(digests)) say(`  ${k}: ${d}`);
  const withinS1 = digests.c1p1 === digests.c1p2, withinS2 = digests.c2p1 === digests.c2p2, across = digests.c1p1 === digests.c2p1;
  say(`  within session 1: ${withinS1} · within session 2: ${withinS2} · across sessions: ${across}`);

  const record = { base: BASE, commit: build.commitShort, branch: build.branch, takenAt: new Date().toISOString(), rooms, picks, digests, passes };
  const text = JSON.stringify(record);
  if (/postgres(ql)?:\/\//.test(text) || (PASSWORD && text.includes(PASSWORD)) || (BYPASS && text.includes(BYPASS))) {
    invalid("refusing to write a crawl record containing a credential");
  }
  writeFileSync(outPath, text);
  say(`\nWROTE ${outPath}`);
  if (!withinS1 || !withinS2) { say("\nCFR-1.2: FAIL — repeated renders within one session are not byte-identical."); process.exit(1); }
  say(`\nCFR-1.2 capture complete${across ? " (both sessions identical)" : " (sessions differ — classify against the baseline before concluding)"}.`);
}

function compare(baselinePath: string, subjectPath: string): void {
  const A = JSON.parse(readFileSync(baselinePath, "utf8")), B = JSON.parse(readFileSync(subjectPath, "utf8"));
  const rooms: string[] = A.rooms;
  const diffs = rooms.map((r) => classifyRoom(r, A.passes.c1p1[r], B.passes.c1p1[r]));
  const v = verdictFor(diffs);
  say(`=== CFR-1.2 COMPARISON · ${rooms.length} rooms`);
  say(`  identical: ${v.identical} · clock-derived: ${v.clockDerived} · offending: ${v.offending.length}`);
  for (const d of diffs.filter((x) => x.kind !== "IDENTICAL")) say(`     ${d.kind.padEnd(14)} ${d.room.padEnd(46)} ${d.detail}`);
  say(`\nCFR-1.2: ${v.pass ? "PASS" : "FAIL"}`);
  process.exit(v.pass ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv[0] === "--compare") {
  if (!argv[1] || !argv[2]) { say("usage: --compare <baseline.json> <subject.json>"); process.exit(2); }
  compare(argv[1], argv[2]);
} else if (argv.includes("--preflight")) {
  await preflight(new Jar());
  say("\nPREFLIGHT OK — the deployment, the session and the room inventory are all as required.");
} else {
  const i = argv.indexOf("--out");
  if (i === -1 || !argv[i + 1]) { say("usage: --out <file.json> [--preflight] [--compare a b]"); process.exit(2); }
  if (argv.includes("--rooms") && argv[argv.indexOf("--rooms") + 1] === "baseline") process.env.CFR12_ROOMS = "baseline";
  await crawl(argv[i + 1]);
}
