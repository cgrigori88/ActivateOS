// Screens for P2B (Value Case).
// Usage: PURSUIT=<id> ACCOUNT=<companyId> node scripts/value-screens.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const base = process.env.BASE ?? "http://127.0.0.1:3100";
const PURSUIT = process.env.PURSUIT, ACCOUNT = process.env.ACCOUNT, CONFLICT = process.env.CONFLICT;
const outDir = process.env.OUTDIR ?? "audit/intel-wave-screens/p2b";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });
const surfaces = [
  ["pursuit-value", `/pursuits/${PURSUIT}`],
  ["pursuit-value-conflicting", `/pursuits/${CONFLICT}`],
  ["brief-sponsor", `/briefs/${PURSUIT}`],
  ["accounts-value", `/accounts?sel=${ACCOUNT}`],
  ["pipeline-value-conflicting", "/pipeline?view=all&value=conflicting"],
  ["motions-value-aggregate", "/motions"],
  ["today-value", "/?today=all"],
];
async function cap(page, name, path, tag) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${name}.${tag}.png`), fullPage: true }).catch((e) => console.log("  ! " + name + " " + tag + ": " + e.message));
  console.log(`  ✓ ${name}.${tag}`);
}
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  const d = await b.newContext({ viewport: { width: 1440, height: 980 } });
  const dp = await d.newPage();
  for (const [n, p] of surfaces) await cap(dp, n, p, "desktop");
  // Progressive disclosure opened: drivers, provenance, sensitivity arithmetic.
  await dp.goto(base + `/pursuits/${PURSUIT}`, { waitUntil: "networkidle" }).catch(() => {});
  await dp.evaluate(() => document.querySelectorAll("#value details").forEach((x) => (x.open = true)));
  await dp.waitForTimeout(300);
  await dp.screenshot({ path: join(outDir, "pursuit-value-open.desktop.png"), fullPage: true }).catch(() => {});
  console.log("  ✓ pursuit-value-open.desktop");
  await d.close();
  const k = await b.newContext({ viewport: { width: 1440, height: 980 } });
  await k.addInitScript(() => localStorage.setItem("pursuitos:theme", "dark"));
  const kp = await k.newPage();
  for (const [n, p] of [["pursuit-value", `/pursuits/${PURSUIT}`], ["pursuit-value-conflicting", `/pursuits/${CONFLICT}`]]) await cap(kp, n, p, "dark");
  await k.close();
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  for (const [n, p] of [["pursuit-value", `/pursuits/${PURSUIT}`], ["pursuit-value-conflicting", `/pursuits/${CONFLICT}`]]) await cap(mp, n, p, "mobile");
  await m.close();
} finally { await b.close(); }
