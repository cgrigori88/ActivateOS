// Screens for P2C-0 + P2A (lifecycle intelligence + the query registry).
// Usage: PURSUIT=<pursuitId> ACCOUNT=<companyId> node scripts/lifecycle-screens.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:3100";
const PURSUIT = process.env.PURSUIT;
const ACCOUNT = process.env.ACCOUNT;
const outDir = process.env.OUTDIR ?? "audit/intel-wave-screens/p2a";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });

const surfaces = [
  ["today", "/"],
  ["today-all", "/?today=all"],
  ["pursuit-lifecycle", `/pursuits/${PURSUIT}`],
  ["accounts-whynow", `/accounts?sel=${ACCOUNT}`],
  ["pipeline-radar", "/pipeline?view=all"],
  ["pipeline-life-conflicting", "/pipeline?view=all&life=conflicting"],
  ["pipeline-life-renew90", "/pipeline?view=all&life=renew90"],
  ["motions-lifecycle-context", "/motions"],
];

async function capture(page, name, path, tag) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${name}.${tag}.png`), fullPage: true })
    .catch((e) => console.log("  ! " + name + " " + tag + ": " + e.message));
  console.log(`  ✓ ${name}.${tag}`);
}

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  const dctx = await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  const dp = await dctx.newPage();
  for (const [name, path] of surfaces) await capture(dp, name, path, "desktop");

  // The lifecycle bento's progressive disclosure OPENED — the evidence tier is one click, not the
  // first thing a reader is shown.
  await dp.goto(base + `/pursuits/${PURSUIT}`, { waitUntil: "networkidle" }).catch(() => {});
  await dp.evaluate(() => document.querySelectorAll("#whynow details").forEach((d) => (d.open = true)));
  await dp.waitForTimeout(300);
  await dp.screenshot({ path: join(outDir, "pursuit-lifecycle-open.desktop.png"), fullPage: true }).catch(() => {});
  console.log("  ✓ pursuit-lifecycle-open.desktop");
  await dctx.close();

  // Dark.
  const kctx = await b.newContext({ viewport: { width: 1440, height: 980 } });
  await kctx.addInitScript(() => localStorage.setItem("pursuitos:theme", "dark"));
  const kp = await kctx.newPage();
  for (const [name, path] of [["pursuit-lifecycle", `/pursuits/${PURSUIT}`], ["today", "/"], ["pipeline-life-conflicting", "/pipeline?view=all&life=conflicting"]])
    await capture(kp, name, path, "dark");
  await kctx.close();

  // Mobile.
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  for (const [name, path] of [["pursuit-lifecycle", `/pursuits/${PURSUIT}`], ["today", "/"], ["pipeline-life-conflicting", "/pipeline?view=all&life=conflicting"]])
    await capture(mp, name, path, "mobile");
  await mctx.close();
} finally {
  await b.close();
}
