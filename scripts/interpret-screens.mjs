/**
 * P2C-1 screenshots. Captures the Ask room (which is the surface P2C-1 rewrote) and the ⌘K palette
 * answering the same questions through the same stack, desktop + mobile, light + dark.
 *
 *   node scripts/interpret-screens.mjs   (expects `npx next start -p 3100` already running)
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = "audit/intel-wave-screens/p2c1";
const EXE = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(OUT, { recursive: true });

const shots = [
  ["ask-room", "/ask", { width: 1440, height: 1600 }],
  ["ask-room-mobile", "/ask", { width: 420, height: 1500 }],
];

const PALETTE_QUERIES = [
  ["palette-attention", "what should I focus on today"],
  ["palette-changed", "what materially changed in the last 30 days"],
  ["palette-compound", "show WWT pursuits over $500K renewing in 90 days without a verified economic buyer"],
  ["palette-motion-constrained", "which motion has the most constrained revenue"],
];

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });

for (const theme of ["light", "dark"]) {
  for (const [name, path, viewport] of shots) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    if (theme === "dark") await ctx.addInitScript(() => localStorage.setItem("pursuitos:theme", "dark"));
    const page = await ctx.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}-${theme}.png`, fullPage: true });
    console.log(`  ✓ ${name}-${theme}.png`);
    await ctx.close();
  }
}

// The palette answers through the same stack — captured via its API so the JSON is inspectable
// alongside the rendered rooms.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
for (const [name, q] of PALETTE_QUERIES) {
  const res = await page.request.get(`${BASE}/api/palette?q=${encodeURIComponent(q)}`);
  const body = await res.json();
  console.log(`  · ${name}: intent=${body.intent} key=${body.intentKey} path=${body.path} outcome=${body.outcome} results=${(body.results ?? []).length}`);
  console.log(`      interpreted: ${body.interpreted ?? body.note ?? "—"}`);
}
await ctx.close();
await browser.close();
console.log(`\nScreens in ${OUT}`);
