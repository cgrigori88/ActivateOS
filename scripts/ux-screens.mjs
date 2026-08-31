// After-screens for the P1AB UX normalization pass.
// Usage: NODE=<taxonomyNodeId> CDW=<partnerId> OUTDIR=<dir> node scripts/ux-screens.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:3100";
const NODE = process.env.NODE;
const CDW = process.env.CDW;
const outDir = process.env.OUTDIR ?? "audit/intel-wave-screens/ux-after";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });

const surfaces = [
  ["motions-overview", "/motions"],
  ["motions-constraints", "/motions?view=constraints"],
  ["motions-pursuits", "/motions?view=pursuits"],
  ["motions-manage", "/motions?view=manage"],
  ["motions-drawer-family", `/motions?view=constraints&mdrawer=${NODE}&mstage=${encodeURIComponent("family:ACCEPTANCE_PENDING")}`],
  ["motions-drawer-notready", `/motions?mdrawer=${NODE}&mstage=not_ready`],
  ["partner-cdw", `/partners/${CDW}`],
];

async function capture(page, name, path, theme, tag) {
  await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${name}.${tag}.png`), fullPage: true }).catch((e) => console.log("  ! " + name + " " + tag + ": " + e.message));
  console.log(`  ✓ ${name}.${tag}`);
}

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  const dctx = await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  const dp = await dctx.newPage();
  for (const [name, path] of surfaces) await capture(dp, name, path, "light", "desktop");
  for (const [name, path] of [["motions-overview", "/motions"], ["motions-constraints", "/motions?view=constraints"], ["partner-cdw", `/partners/${CDW}`]])
    await capture(dp, name, path, "dark", "dark");
  // Partner room with Manage expanded (progressive disclosure open) — proof nothing was removed.
  await dp.goto(base + `/partners/${CDW}`, { waitUntil: "networkidle" }).catch(() => {});
  await dp.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); for (const d of document.querySelectorAll("details")) d.open = true; });
  await dp.waitForTimeout(300);
  await dp.screenshot({ path: join(outDir, "partner-cdw-manage-open.desktop.png"), fullPage: true });
  console.log("  ✓ partner-cdw-manage-open.desktop");
  await dctx.close();

  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mp = await mctx.newPage();
  for (const [name, path] of [["motions-overview", "/motions"], ["motions-constraints", "/motions?view=constraints"], ["motions-pursuits", "/motions?view=pursuits"], ["motions-drawer-family", surfaces[4][1]], ["partner-cdw", `/partners/${CDW}`]])
    await capture(mp, name, path, "light", "mobile");
  await mctx.close();
} finally {
  await b.close();
}
console.log("done → " + outDir);
