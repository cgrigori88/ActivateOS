"use server";

import { revalidatePath } from "next/cache";

/**
 * CSV upload → the worker's /import endpoint (Railway, no serverless timeout),
 * which ingests under the chosen partner and auto-queues a screen. The trigger
 * secret stays server-side; the browser never sees it.
 */
export async function uploadAccountsAction(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;

  const org = String(formData.get("org") || "Production").trim() || "Production";
  const partner = String(formData.get("partner") || "").trim();
  const partnerType = String(formData.get("partnerType") || "reseller");

  const base = process.env.WORKER_URL;
  const secret = process.env.RESEARCH_TRIGGER_SECRET;
  if (!base || !secret) {
    throw new Error("Upload not configured: set WORKER_URL and RESEARCH_TRIGGER_SECRET.");
  }

  const qs = new URLSearchParams({ org, filename: file.name, by: "web" });
  if (partner) {
    qs.set("partner", partner);
    qs.set("partnerType", partnerType);
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/import?${qs.toString()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "text/csv" },
    body: await file.text(),
  });
  if (!res.ok) {
    throw new Error(`Import failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  revalidatePath("/intake");
}
