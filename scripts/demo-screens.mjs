// Demo surface capture for the Pilot Commissioning package.
// Captures the major PursuitOS surfaces in desktop light, desktop dark, and mobile.
// Usage: HERO=<id> OUTDIR=<dir> node scripts/demo-screens.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:3100";
const HERO = process.env.HERO;
const outDir = process.env.OUTDIR ?? "audit/demo-screens";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });

const surfaces = [
  ["today", "/"],
  ["pursuits", "/pursuits"],
  ["pursuit-hero", "/pursuits/" + HERO],
  ["queue", "/queue"],
  ["accounts", "/accounts"],
  ["partners", "/partners"],
  ["motions", "/motions"],
  ["campaigns", "/campaigns"],
  ["pipeline", "/pipeline"],
  ["analytics", "/analytics"],
  ["insights", "/insights"],
  ["sources", "/sources"],
  ["trust", "/trust"],
];

// Theme is applied by data-theme on the root (light/dark) per the design system.
async function capture(page, name, path, theme, tag) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${name}.${tag}.png`), fullPage: true }).catch((e) => console.log("  ! " + name + " " + tag + ": " + e.message));
  console.log(`  ✓ ${name}.${tag}`);
}

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  // Desktop light + dark
  const dctx = await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  const dp = await dctx.newPage();
  for (const [name, path] of surfaces) await capture(dp, name, path, "light", "desktop-light");
  for (const [name, path] of surfaces) await capture(dp, name, path, "dark", "desktop-dark");
  await dctx.close();

  // Mobile (decision-first ordering) — a representative subset
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mp = await mctx.newPage();
  for (const [name, path] of [["today", "/"], ["pursuits", "/pursuits"], ["pursuit-hero", "/pursuits/" + HERO], ["pipeline", "/pipeline"], ["analytics", "/analytics"]])
    await capture(mp, name, path, "light", "mobile-light");
  await mctx.close();
} finally {
  await b.close();
}
console.log("done → " + outDir);
