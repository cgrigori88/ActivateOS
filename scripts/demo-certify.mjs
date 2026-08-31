/**
 * TD SYNNEX demo certification walk (§6).
 *
 * Drives a real Chromium over every room in the demo journey, on a production build against clean
 * demo state, and checks each one for the failure modes that actually embarrass a walkthrough:
 * a 404, a dead CTA, an empty room, a leaked confidential figure, a debug string in the customer
 * view, a page that scrolls forever.
 *
 * Every check is mechanical and reported PASS/FAIL — this file makes no judgement about whether a
 * room is *good*, only whether it is intact. Visual judgement happens by reading the screenshots
 * it captures.
 *
 *   node scripts/demo-certify.mjs            (expects `npx next start -p 3100` running)
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = "audit/intel-wave-screens/tdsynnex";
const EXE = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PURSUIT = process.env.PURSUIT;          // Globex Manufacturing — the hero pursuit
const CONFLICT = process.env.CONFLICT;        // Umbrella — the contradicted-economics pursuit
const ACCOUNT = process.env.ACCOUNT;          // Globex account id
const PARTNER = process.env.PARTNER;          // WWT partner id
const MOTION = process.env.MOTION;            // hero motion slug
const PARTNER2 = process.env.PARTNER2 ?? PARTNER;  // a second partner, for the disclosure check

mkdirSync(OUT, { recursive: true });

/**
 * The sponsor-confidential figure from the P2B demo world (Wayne's TRANSACTION_CONFIDENTIAL
 * baseline). It is checked ONLY on the partner-facing surfaces, where it must never appear.
 *
 * A first version scanned every page for the formatted "$1.84M" and reported a leak on the Globex
 * pursuit — which turned out to be "$1.84M recent category activity through TD SYNNEX", a different
 * account and a different number that happens to round the same way. A leak test that fires on
 * coincidence is worse than none: it trains you to ignore it. The exact digits are the honest probe.
 */
const CONFIDENTIAL = ["1,840,000", "1840000"];
/** Strings that mean a developer artifact reached the customer view. */
const DEBUG_SMELLS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /TODO:/, /FIXME/, /Error:/i];

const ROOMS = [
  { step: "1  Today",                    path: "/",                                    must: [/Today|attention|decision/i] },
  { step: "2a Motion Overview",          path: "/motions",                             must: [/Motion|hypothesis/i] },
  { step: "2b Motion Constraints",       path: "/motions?view=constraints",            must: [/constrain|blocker/i] },
  { step: "3  Partner Activation",       path: () => `/partners/${PARTNER}`,           must: [/activation|presence|execution/i] },
  { anchored: true, step: "4  Pursuit Detail",           path: () => `/pursuits/${PURSUIT}`,           must: [/why now|route|pursuit/i] },
  { step: "5  Sponsor/Partner review",   path: () => `/partners/${PARTNER}/review`,    must: [/partner|shared|disclos/i], partnerFacing: true },
  { step: "5b Partner review (2nd partner)", path: () => `/partners/${PARTNER2}/review`, must: [/partner/i], partnerFacing: true },
  { anchored: true, step: "6  Execution plan",           path: () => `/pursuits/${PURSUIT}#team`,      must: [/team|accept|invite/i] },
  { anchored: true, step: "7  Stakeholder Intelligence", path: () => `/pursuits/${PURSUIT}#stakeholders`, must: [/economic buyer|champion|coverage/i] },
  { anchored: true, step: "8  Value Case",               path: () => `/pursuits/${PURSUIT}#value`,     must: [/value case|modeled|at stake/i] },
  { anchored: true, step: "8b Value Case (conflict)",    path: () => `/pursuits/${CONFLICT}#value`,    must: [/conflict|contested|contradict/i] },
  { anchored: true, step: "9  Lifecycle",                path: () => `/pursuits/${PURSUIT}#whynow`,    must: [/why now|renewal|timing/i] },
  { step: "10a Pipeline Attention",      path: "/pipeline",                            must: [/pipeline|attention|renewal/i] },
  { step: "10b Pipeline Portfolio",      path: "/pipeline?view=portfolio",             must: [/pipeline/i] },
  { step: "11 Ask",                      path: "/ask",                                 must: [/Ask|answer/i] },
  { step: "12 Insights",                 path: "/insights",                            must: [/insight|outcome|calibrat/i] },
  { anchored: true, step: "—  Brief",                    path: () => `/pursuits/${PURSUIT}#brief`,     must: [/brief|business value|know/i] },
  { step: "—  Accounts",                 path: () => `/accounts/${ACCOUNT}`,           must: [/account|intelligence|evidence/i] },
];

const results = [];
const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });

for (const room of ROOMS) {
  const path = typeof room.path === "function" ? room.path() : room.path;
  const before = consoleErrors.length;
  const fails = [];
  let status = 0, text = "", height = 0, links = 0, deadLinks = [];

  try {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(250);
    text = await page.evaluate(() => document.body.innerText);
    // documentElement, not body: an inner scroll container leaves body.scrollHeight at a
    // viewport-sized value, which silently passed a 9,000px room as if it were short.
    height = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));

    if (status >= 400) fails.push(`HTTP ${status}`);
    // Content actually rendered, not a shell.
    if (text.trim().length < 200) fails.push(`page is nearly empty (${text.trim().length} chars)`);
    for (const re of room.must) if (!re.test(text)) fails.push(`expected content missing: ${re}`);
    if (room.partnerFacing) {
      for (const c of CONFIDENTIAL) if (text.includes(c)) fails.push(`CONFIDENTIAL FIGURE LEAKED: ${c}`);
      // The formatted form too, but only here, where a coincidence is far less likely and a real
      // leak would be catastrophic.
      if (/\$1\.84\s?M/.test(text)) fails.push("CONFIDENTIAL FIGURE LEAKED (formatted): $1.84M");
    }
    for (const re of DEBUG_SMELLS) if (re.test(text)) fails.push(`debug artifact in customer view: ${re}`);
    // Excessive scroll: a demo room that runs past ~6 viewports is a scrolling problem on stage.
    // Rooms the journey enters BY ANCHOR are allowed to be long — the demo never scrolls them,
    // it deep-links into the section it wants. Everything else must fit a few viewports.
    const limit = room.anchored ? 12000 : 6000;
    if (height > limit) fails.push(`excessive scroll: ${height}px (limit ${limit})`);

    // Every in-app link resolves. Checked by HEAD so the walk stays quick.
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href")).filter(Boolean));
    const unique = [...new Set(hrefs)].slice(0, 40);
    links = unique.length;
    for (const h of unique) {
      const r = await page.request.get(`${BASE}${h}`, { failOnStatusCode: false });
      if (r.status() >= 400) deadLinks.push(`${h} → ${r.status()}`);
    }
    if (deadLinks.length) fails.push(`dead links: ${deadLinks.join(", ")}`);

    const newErrors = consoleErrors.slice(before);
    if (newErrors.length) fails.push(`console errors: ${newErrors.join(" | ")}`);

    const name = room.step.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  } catch (err) {
    fails.push(`navigation failed: ${String(err).slice(0, 120)}`);
  }

  results.push({ step: room.step, path, status, links, height, fails });
  console.log(`${fails.length === 0 ? "PASS" : "FAIL"}  ${room.step.padEnd(26)} ${path}`);
  for (const f of fails) console.log(`        ✗ ${f}`);
}

await ctx.close();
await browser.close();

const passed = results.filter((r) => r.fails.length === 0).length;
console.log(`\n${passed}/${results.length} rooms certified`);
writeFileSync(`${OUT}/certification.json`, JSON.stringify(results, null, 2));
if (passed < results.length) process.exitCode = 1;
