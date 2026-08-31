// After-screens for P1C Stakeholder Intelligence.
// Usage: GLOBEX=<id> STARK=<id> UMBRELLA=<id> PREOPP=<id> node scripts/p1c-screens.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.env.BASE ?? "http://127.0.0.1:3100";
const out = process.env.OUTDIR ?? "audit/stakeholder-screens";
mkdirSync(out, { recursive: true });
const P = (id) => `/pursuits/${id}`;
const { GLOBEX, STARK, UMBRELLA, PREOPP } = process.env;

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

async function shoot(ctx, name, path, opts = {}) {
  const p = await ctx.newPage();
  await p.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
  if (opts.openRoles) await p.evaluate(() => { for (const d of document.querySelectorAll("#stakeholders details")) d.open = true; });
  await p.waitForTimeout(400);
  if (opts.clip) {
    const el = await p.$("#stakeholders");
    if (el) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); await el.screenshot({ path: join(out, name + ".png") }); }
    else console.log("  ! no #stakeholders on " + path);
  } else {
    await p.screenshot({ path: join(out, name + ".png"), fullPage: true });
  }
  console.log("  ✓ " + name);
  await p.close();
}

const d = await b.newContext({ viewport: { width: 1440, height: 980 } });
await shoot(d, "pursuit-globex.desktop", P(GLOBEX));
await shoot(d, "stakeholders-globex-open.desktop", P(GLOBEX), { clip: true, openRoles: true });
await shoot(d, "stakeholders-stark-missing.desktop", P(STARK), { clip: true });
await shoot(d, "stakeholders-umbrella-unverified.desktop", P(UMBRELLA), { clip: true, openRoles: true });
await shoot(d, "stakeholders-preopportunity-unknown.desktop", P(PREOPP), { clip: true });
await shoot(d, "today.desktop", "/");
await shoot(d, "motions-constraints-overlay.desktop", "/motions?view=constraints");
await shoot(d, "contacts.desktop", "/contacts");
await d.close();

const dk = await b.newContext({ viewport: { width: 1440, height: 980 } });
await dk.addInitScript(() => { try { localStorage.setItem("pursuitos:theme", "dark"); } catch {} });
await shoot(dk, "pursuit-globex.dark", P(GLOBEX));
await shoot(dk, "motions-constraints-overlay.dark", "/motions?view=constraints");
await dk.close();

const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await shoot(m, "pursuit-globex.mobile", P(GLOBEX));
await shoot(m, "today.mobile", "/");
await m.close();
await b.close();
console.log("done → " + out);
