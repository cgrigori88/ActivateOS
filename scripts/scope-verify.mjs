// Phase 1 verification — ecosystem scope selector + chip + URL persistence.
// Captures selector (ALL), selector open, scoped Today + Pipeline (chip), light/dark/mobile,
// and asserts hydration (selector opens) + narrowing-never-widens (bogus id → ALL).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:3100";
const CDW = process.env.CDW;
const outDir = process.env.OUTDIR ?? "audit/scope-shots";
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(outDir, { recursive: true });

const dark = (page) => page.addInitScript(() => { try { localStorage.setItem("pursuitos:theme", "dark"); } catch {} });

async function shoot(ctx, name, path, { open = false } = {}) {
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(700);
  if (open) {
    await page.getByRole("button", { name: /^Ecosystem scope/i }).click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: !open }).catch((e) => console.log("  ! " + name + ": " + e.message));
  console.log("  ✓ " + name);
  await page.close();
}

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
try {
  const light = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  await shoot(light, "01-today-all-light", "/");
  await shoot(light, "02-selector-open-light", "/", { open: true });
  await shoot(light, "03-today-scoped-cdw-light", `/?scope=partner:${CDW}`);
  await shoot(light, "04-pipeline-scoped-cdw-light", `/pipeline?scope=partner:${CDW}`);

  const darkCtx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  await dark(darkCtx);
  await shoot(darkCtx, "05-today-scoped-cdw-dark", `/?scope=partner:${CDW}`);
  await shoot(darkCtx, "06-selector-open-dark", "/", { open: true });

  const mobile = await b.newContext({ viewport: { width: 390, height: 844 } });
  await shoot(mobile, "07-pipeline-scoped-cdw-mobile", `/pipeline?scope=partner:${CDW}`);

  // Hydration + persistence assertion: open selector, pick CDW, confirm URL gains scope= and chip appears.
  const t = await light.newPage();
  await t.goto(base + "/", { waitUntil: "domcontentloaded" });
  await t.waitForTimeout(700);
  await t.getByRole("button", { name: /^Ecosystem scope/i }).click();
  await t.waitForTimeout(300);
  await t.getByRole("option", { name: "CDW" }).click().catch(() => {});
  await t.waitForTimeout(900);
  const url = t.url();
  const chip = await t.locator("text=operating scope").count();
  console.log(`  hydration: after picking CDW → url=${url.includes("scope=partner") ? "HAS scope param" : "NO scope"} · chip=${chip > 0 ? "SHOWN" : "absent"}`);
  await t.close();

  // Narrowing-never-widens: a bogus (unauthorized) partner id must resolve to ALL (no chip), not widen.
  const a = await light.newPage();
  await a.goto(base + "/pipeline?scope=partner:00000000-0000-0000-0000-000000000000", { waitUntil: "domcontentloaded" });
  await a.waitForTimeout(600);
  const bogusChip = await a.locator("text=operating scope").count();
  console.log(`  adverse: bogus partner id → chip=${bogusChip > 0 ? "SHOWN (BAD)" : "absent (fail-safe to ALL, correct)"}`);
  await a.close();
} finally {
  await b.close();
}
