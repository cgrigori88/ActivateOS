/**
 * One-shot communications infrastructure setup (Phase 5B go-live).
 *
 * Prerequisites:
 *   - pursuitos.io nameservers moved to Vercel (ns1/ns2.vercel-dns.com)
 *   - RESEND_API_KEY set (plus VERCEL_TOKEN, VERCEL_TEAM_ID)
 *
 * What it does (idempotent, safe to re-run):
 *   1. Registers engage.<apex> (outbound) and threads.<apex> (inbound)
 *      as domains in Resend.
 *   2. Mirrors every DNS record Resend requires into Vercel DNS.
 *   3. Adds a DMARC record (p=none to start).
 *   4. Asks Resend to verify both domains.
 *   5. Creates the Resend webhook → app; prints the signing secret to be
 *      stored as RESEND_WEBHOOK_SECRET.
 *
 * Usage: npm run setup-comms  (or: tsx scripts/setup-comms-dns.ts)
 */

const APEX = process.env.COMMS_APEX_DOMAIN ?? "pursuitos.io";
const OUTBOUND = process.env.EMAIL_OUTBOUND_DOMAIN ?? `engage.${APEX}`;
const THREADS = process.env.EMAIL_THREADS_DOMAIN ?? `threads.${APEX}`;
const APP_URL = process.env.APP_URL ?? "https://pursuitos.vercel.app";

const RESEND = "https://api.resend.com";
const VERCEL = "https://api.vercel.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function resend(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${RESEND}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function vercel(path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${VERCEL}${path}${sep}teamId=${env("VERCEL_TEAM_ID")}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env("VERCEL_TOKEN")}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

interface ResendRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  status?: string;
}

async function ensureResendDomain(name: string): Promise<{ id: string; records: ResendRecord[] }> {
  const list = await (await resend("/domains")).json() as { data?: { id: string; name: string }[] };
  const existing = (list.data ?? []).find((d) => d.name === name);
  let id: string;
  if (existing) {
    id = existing.id;
    console.log(`resend: domain ${name} already registered (${id})`);
  } else {
    const res = await resend("/domains", { method: "POST", body: JSON.stringify({ name }) });
    if (!res.ok) throw new Error(`resend create ${name} failed: ${await res.text()}`);
    id = ((await res.json()) as { id: string }).id;
    console.log(`resend: registered domain ${name} (${id})`);
  }
  const detail = (await (await resend(`/domains/${id}`)).json()) as { records?: ResendRecord[] };
  return { id, records: detail.records ?? [] };
}

/** Resend record names are relative to ITS domain; Vercel wants zone-relative. */
export function zoneRelativeName(resendName: string, resendDomain: string, apex: string): string {
  const sub = resendDomain === apex ? "" : resendDomain.slice(0, -(apex.length + 1));
  const rel = resendName === resendDomain ? "" : resendName.replace(`.${resendDomain}`, "");
  return [rel, sub].filter(Boolean).join(".");
}

async function ensureVercelRecord(rec: {
  name: string;
  type: string;
  value: string;
  mxPriority?: number;
}): Promise<void> {
  const existing = (await (
    await vercel(`/v4/domains/${APEX}/records?limit=100`)
  ).json()) as { records?: { id: string; name: string; type: string; value: string }[] };
  const dup = (existing.records ?? []).find(
    (r) =>
      r.name === rec.name && r.type === rec.type && r.value.replace(/"/g, "") === rec.value.replace(/"/g, ""),
  );
  if (dup) {
    console.log(`vercel dns: ${rec.type} ${rec.name || "@"} already present`);
    return;
  }
  const res = await vercel(`/v2/domains/${APEX}/records`, {
    method: "POST",
    body: JSON.stringify({ ...rec, ttl: 3600 }),
  });
  if (!res.ok) {
    console.warn(`vercel dns: FAILED ${rec.type} ${rec.name || "@"}: ${await res.text()}`);
  } else {
    console.log(`vercel dns: added ${rec.type} ${rec.name || "@"} → ${rec.value.slice(0, 60)}`);
  }
}

async function main() {
  // 0. Sanity: nameservers should be on Vercel or records will not resolve.
  const cfg = (await (await vercel(`/v6/domains/${APEX}/config`)).json()) as {
    nameservers?: string[];
  };
  const ns = cfg.nameservers ?? [];
  if (!ns.some((n) => n.includes("vercel-dns"))) {
    console.warn(
      `WARNING: ${APEX} nameservers are ${ns.join(", ") || "unknown"} — not Vercel. ` +
        `Records added below only take effect once nameservers move to Vercel DNS.`,
    );
  }

  for (const domain of [OUTBOUND, THREADS]) {
    const { id, records } = await ensureResendDomain(domain);
    for (const r of records) {
      await ensureVercelRecord({
        name: zoneRelativeName(r.name, domain, APEX),
        type: r.type.toUpperCase(),
        value: r.value,
        ...(r.priority != null ? { mxPriority: r.priority } : {}),
      });
    }
    const verify = await resend(`/domains/${id}/verify`, { method: "POST" });
    console.log(`resend: verification requested for ${domain} (${verify.status})`);
  }

  await ensureVercelRecord({ name: "_dmarc", type: "TXT", value: "v=DMARC1; p=none;" });

  // Webhook (delivery events + inbound). If the API rejects, do it in the
  // dashboard: endpoint = <app>/api/webhooks/resend, all email events.
  const endpoint = `${APP_URL}/api/webhooks/resend`;
  const hooks = await resend("/webhooks");
  const hookList = hooks.ok
    ? ((await hooks.json()) as { data?: { endpoint: string }[] }).data ?? []
    : [];
  if (hookList.some((h) => h.endpoint === endpoint)) {
    console.log("resend: webhook already exists");
  } else {
    const res = await resend("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        endpoint,
        events: [
          "email.sent",
          "email.delivered",
          "email.bounced",
          "email.opened",
          "email.clicked",
          "email.complained",
          "email.received",
        ],
      }),
    });
    if (res.ok) {
      const body = (await res.json()) as { signing_secret?: string; secret?: string };
      const secret = body.signing_secret ?? body.secret;
      console.log(`resend: webhook created → ${endpoint}`);
      if (secret) {
        console.log(`RESEND_WEBHOOK_SECRET=${secret}`);
        console.log("^ store this in Vercel env + .env.local");
      } else {
        console.log("copy the signing secret from the Resend dashboard → RESEND_WEBHOOK_SECRET");
      }
    } else {
      console.warn(
        `resend: webhook API unavailable (${res.status}) — create it in the dashboard: ` +
          `endpoint ${endpoint}, subscribe to all email events, copy the signing secret.`,
      );
    }
  }

  console.log("\nDone. Check both domains show 'verified' in Resend (can take a few minutes " +
    "after nameservers propagate), then set RESEND_API_KEY + RESEND_WEBHOOK_SECRET in Vercel.");
}

if (process.argv[1]?.endsWith("setup-comms-dns.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
