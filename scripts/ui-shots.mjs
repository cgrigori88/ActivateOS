/**
 * Visual-system inspection sheet. One batched round over the rooms the
 * normalization brief names, at both breakpoints and in both themes, so the
 * whole pass can be judged from one set of captures rather than a screenshot
 * trip per edit.
 *
 *   TAG=before node scripts/ui-shots.mjs     (expects `npx next start -p 3100`)
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const TAG = process.env.TAG ?? "after";
const OUT = `audit/ui-normalization/${TAG}`;
const EXE = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PURSUIT = process.env.PURSUIT ?? "";
const ACCOUNT = process.env.ACCOUNT ?? "";
const PARTNER = process.env.PARTNER ?? "";

mkdirSync(OUT, { recursive: true });

const ROOMS = [
  ["today", "/"],
  ["motions", "/motions"],
  ["motions-constraints", "/motions?view=constraints"],
  ["partners", "/partners"],
  ["partner-detail", `/partners/${PARTNER}`],
  ["pursuits", "/pursuits"],
  ["pursuit-detail", `/pursuits/${PURSUIT}`],
  ["accounts", "/accounts"],
  ["account-detail", `/accounts/${ACCOUNT}`],
  ["pipeline", "/pipeline"],
  ["insights", "/insights"],
  ["ask", "/ask"],
  ["queue", "/queue"],
  ["mapping", "/mapping"],
];

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });

for (const [theme, viewport, suffix] of [
  ["light", { width: 1440, height: 1000 }, "light"],
  ["dark", { width: 1440, height: 1000 }, "dark"],
  ["light", { width: 390, height: 900 }, "mobile"],
]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  if (theme === "dark") await ctx.addInitScript(() => localStorage.setItem("pursuitos:theme", "dark"));
  const page = await ctx.newPage();
  for (const [name, path] of ROOMS) {
    if (path.includes("//") || path.endsWith("/undefined")) continue;
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(220);
      await page.screenshot({ path: `${OUT}/${name}-${suffix}.png`, fullPage: true });
    } catch {
      console.log(`  ! ${name}-${suffix} failed`);
    }
  }
  await ctx.close();
  console.log(`  ✓ ${suffix}`);
}

await browser.close();
console.log(`\n${OUT}`);
