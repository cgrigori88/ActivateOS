// Phase 2 verification — Today command center: exposure band, top-N decisions, why-here, view-all, scope.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const base = "http://127.0.0.1:3100";
const CDW = process.env.CDW;
const outDir = "audit/today-shots";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });
const dark = (ctx) => ctx.addInitScript(() => { try { localStorage.setItem("pursuitos:theme", "dark"); } catch {} });
async function shoot(ctx, name, path, fn) {
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(700);
  if (fn) await fn(page);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }).catch((e) => console.log("  ! " + name + ": " + e.message));
  console.log("  ✓ " + name);
  await page.close();
}
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  const light = await b.newContext({ viewport: { width: 1440, height: 1400 } });
  await shoot(light, "01-today-command-center-light", "/");
  await shoot(light, "02-today-whyhere-open-light", "/", async (p) => { await p.getByText("Why is this here?").first().click().catch(()=>{}); await p.waitForTimeout(300); });
  await shoot(light, "03-today-viewall-light", "/?today=all");
  await shoot(light, "04-today-scoped-cdw-light", `/?scope=partner:${CDW}`);
  const darkCtx = await b.newContext({ viewport: { width: 1440, height: 1400 } });
  await dark(darkCtx);
  await shoot(darkCtx, "05-today-command-center-dark", "/");
  const mobile = await b.newContext({ viewport: { width: 390, height: 900 } });
  await shoot(mobile, "06-today-mobile", "/");
} finally { await b.close(); }
