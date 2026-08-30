// Browser-level hero-flow assertion (Workstream D.5 §R) against the running app.
// Usage: HERO=<id> node scripts/e2e-pursuit.mjs
import { chromium } from "playwright-core";
const base = process.env.BASE ?? "http://localhost:3100";
const HERO = process.env.HERO;
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n); } };

const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

// 1. Portfolio → open the hero pursuit
await p.goto(base + "/pursuits", { waitUntil: "networkidle" });
ok("portfolio lists Globex", await p.locator("text=Globex").first().isVisible());
await p.goto(base + "/pursuits/" + HERO, { waitUntil: "networkidle" });
const body = await p.content();

// 2. Hero decision surface
ok("thesis renders", /Exit legacy virtualization/.test(body));
ok("metric band: Priority + Propensity distinct", body.includes(">Priority<") && body.includes(">Propensity<"));
ok("Why now present", body.includes("Why now"));
ok("missing timing anchor stays unknown", /No verified timing anchor/.test(body));
ok("Facts behind this", body.includes("Facts behind this") && body.includes("strategic initiative"));

// 3. Route decision — recommendation ≠ selection
ok("RoutePath renders CDW node", /CDW/.test(body));
ok("recommended CDW", /Recommended[\s\S]{0,120}CDW/.test(body.replace(/<[^>]+>/g, " ")));
ok("selected WWT (human override)", /WWT/.test(body) && /human override/i.test(body));
ok("dimension: unknown renders 'Not available'", body.includes("Not available"));

// 4. Disclosure split — the centerpiece (internal has the figure, page is the vendor/internal boot)
ok("disclosure split: Internal view", body.includes("Internal view"));
ok("disclosure split: Shareable with partner", body.includes("Shareable with partner"));
// Server-component render: the raw figure never reaches the client; the internal
// view shows the humanized confidential figure, the partner-safe view shows neither.
ok("internal payload shows the confidential figure (humanized)", body.includes("1.84M") && !body.includes("1840000"));

// 5. Team + material changes
ok("Pursuit team", body.includes("Pursuit team") && /readiness held/i.test(body));
ok("What changed (material events)", body.includes("What changed") && /override/i.test(body));

await b.close();
console.log(`\n[e2e-pursuit] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
