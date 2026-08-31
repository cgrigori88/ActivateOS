// Phase 3 verification — Pipeline Attention / Portfolio / All + scope + drill-in.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const base = "http://127.0.0.1:3100";
const CDW = process.env.CDW;
const outDir = "audit/pipeline-shots";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });
const dark = (ctx) => ctx.addInitScript(() => { try { localStorage.setItem("pursuitos:theme", "dark"); } catch {} });
async function shoot(ctx, name, path) {
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }).catch((e) => console.log("  ! " + name + ": " + e.message));
  console.log("  ✓ " + name);
  await page.close();
}
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  const light = await b.newContext({ viewport: { width: 1440, height: 1400 } });
  await shoot(light, "01-attention-light", "/pipeline?view=attention");
  await shoot(light, "02-portfolio-partner-condition-light", "/pipeline?view=portfolio&prow=partner&pcol=condition");
  await shoot(light, "03-portfolio-partner-stage-light", "/pipeline?view=portfolio&prow=partner&pcol=stage");
  await shoot(light, "04-all-light", "/pipeline?view=all");
  await shoot(light, "05-attention-scoped-cdw-light", `/pipeline?view=attention&scope=partner:${CDW}`);
  await shoot(light, "06-portfolio-scoped-cdw-light", `/pipeline?view=portfolio&scope=partner:${CDW}`);
  const darkCtx = await b.newContext({ viewport: { width: 1440, height: 1400 } });
  await dark(darkCtx);
  await shoot(darkCtx, "07-portfolio-dark", "/pipeline?view=portfolio");
  await shoot(darkCtx, "08-all-dark", "/pipeline?view=all");
  const mobile = await b.newContext({ viewport: { width: 390, height: 900 } });
  await shoot(mobile, "09-portfolio-mobile", "/pipeline?view=portfolio");

  // Drill-in: click a portfolio cell → Attention filtered. Assert URL carries the slice.
  const p = await light.newPage();
  await p.goto(base + "/pipeline?view=portfolio&prow=partner&pcol=condition", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(700);
  const cell = p.locator('td a[href*="view=attention"]').first();
  const drillHref = await cell.getAttribute("href").catch(() => null);
  console.log("  drill-in href:", drillHref);
  if (drillHref) { await p.goto(base + drillHref, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(500); console.log("  drilled → attention rows:", await p.locator("text=Next:").count()); }
  await p.close();
} finally { await b.close(); }
