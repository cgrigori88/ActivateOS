import { createHash } from "node:crypto";
import type pg from "pg";
import { crossCheckLLM } from "../agents/extractor";
import { claimFingerprint } from "../quality/checks";
import { verifyEvidence } from "../quality/verify";
import { SIGNAL_DEFS } from "../signals/types";
import type { IntelligenceProvider, IntelligenceTarget } from "./provider";

/**
 * Central intelligence pipeline (DIRECTIVE §1, §5, §26): the ONLY path from
 * a provider to evidence. Responsibilities providers must not own:
 *  - raw-observation persistence + content-hash dedupe (change detection);
 *  - the quality gates (every claim goes through verifyEvidence, first-party
 *    or not);
 *  - signal creation with registry-governed decay/direction;
 *  - run accounting (records/evidence/signals/cost) for §22-23 observability.
 */

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

export interface ProviderRunResult {
  runId: string;
  status: "succeeded" | "failed" | "skipped";
  recordsReceived: number;
  newObservations: number;
  evidenceCreated: number;
  signalsCreated: number;
  error?: string;
}

export async function ensureProviderRow(db: pg.PoolClient, p: IntelligenceProvider): Promise<void> {
  await db.query(
    `insert into providers (id, provider_type, cost_class, enabled, allowed_for_screening, config)
     values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
    [
      p.providerId,
      p.providerType,
      p.costClass,
      !p.disabledReason,
      p.allowedForScreening !== false,
      JSON.stringify(p.disabledReason ? { disabled_reason: p.disabledReason } : {}),
    ],
  );
  // Bootstrap the source-trust prior; audit outcomes evolve it afterwards.
  await db.query(
    `insert into signal_sources (name, kind, trust_score)
     values ($1, $2, $3) on conflict (name) do nothing`,
    [p.providerId, p.sourceKind, p.sourceTrustPrior],
  );
}

export async function providerEnabled(db: pg.PoolClient, providerId: string): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>(
    `select enabled from providers where id = $1`,
    [providerId],
  );
  return rows[0]?.enabled ?? true;
}

export async function runProvider(
  db: pg.PoolClient,
  provider: IntelligenceProvider,
  target: IntelligenceTarget,
  opts: { stage?: "screen" | "deep" | "manual" } = {},
): Promise<ProviderRunResult> {
  await ensureProviderRow(db, provider);

  const { rows: runRows } = await db.query<{ id: string }>(
    `insert into provider_runs (provider_id, org_id, company_id, stage)
     values ($1, $2, $3, $4) returning id`,
    [provider.providerId, target.orgId, target.companyId, opts.stage ?? "screen"],
  );
  const runId = runRows[0].id;
  const finish = async (patch: Record<string, unknown>) => {
    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`);
    await db.query(
      `update provider_runs set ${sets.join(", ")}, finished_at = now() where id = $1`,
      [runId, ...Object.values(patch)],
    );
  };

  if (!(await providerEnabled(db, provider.providerId))) {
    await finish({ status: "skipped" });
    return { runId, status: "skipped", recordsReceived: 0, newObservations: 0, evidenceCreated: 0, signalsCreated: 0 };
  }

  // Run state: lets providers choose baseline vs incremental, and enforces
  // the per-company refresh throttle for metered providers (§24-25).
  const { rows: stateRows } = await db.query<{ last_success: Date | null; obs: string }>(
    `select
       (select max(finished_at) from provider_runs
         where provider_id = $1 and company_id = $2 and status = 'succeeded' and id <> $3) as last_success,
       (select count(*) from raw_observations
         where provider_id = $1 and company_id = $2) as obs`,
    [provider.providerId, target.companyId, runId],
  );
  const lastSuccessAt = stateRows[0].last_success;
  if (
    provider.minRefreshHours &&
    lastSuccessAt &&
    Date.now() - new Date(lastSuccessAt).getTime() < provider.minRefreshHours * 3_600_000
  ) {
    await finish({ status: "skipped" });
    return { runId, status: "skipped", recordsReceived: 0, newObservations: 0, evidenceCreated: 0, signalsCreated: 0 };
  }
  target = {
    ...target,
    state: { lastSuccessAt, observationCount: Number(stateRows[0].obs) },
  };

  try {
    // Optional discovery (e.g. locate the company's job-board token).
    if (provider.discover && !target.handles) {
      target = { ...target, handles: (await provider.discover(target)) ?? undefined };
    }

    const observations = await provider.fetch(target);

    // An empty fetch — no domain, gated out by category, no public asset, or
    // no data — is NOT a throttle-worthy refresh. Record it as skipped so a
    // later, genuinely-relevant pursuit isn't blocked by minRefreshHours.
    if (observations.length === 0) {
      await finish({ status: "skipped" });
      return { runId, status: "skipped", recordsReceived: 0, newObservations: 0, evidenceCreated: 0, signalsCreated: 0 };
    }

    // Persist raw FIRST; the unique index makes unchanged content a no-op —
    // this is the change-detection backbone (§25-26): unchanged = stop.
    const withNovelty: { payload: unknown; observedAt: Date; isNew: boolean }[] = [];
    let newCount = 0;
    for (const o of observations) {
      const { rows } = await db.query<{ id: string }>(
        `insert into raw_observations
           (org_id, provider_id, company_id, target_domain, external_record_id,
            source_published_at, source_url, raw_payload, content_hash, cost_usd)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (provider_id, company_id, content_hash)
           where content_hash is not null do nothing
         returning id`,
        [
          target.orgId, provider.providerId, target.companyId, target.domain,
          o.externalRecordId ?? null, o.sourcePublishedAt ?? null, o.sourceUrl ?? null,
          JSON.stringify(o.payload), o.contentHash, o.costUsd ?? 0,
        ],
      );
      const isNew = rows.length > 0;
      if (isNew) newCount++;
      withNovelty.push({ payload: o.payload, observedAt: new Date(), isNew });
    }

    // History for change-over-time features (velocity needs the past) —
    // excluding rows just written by this run.
    const { rows: history } = await db.query<{ raw_payload: unknown; observed_at: Date }>(
      `select raw_payload, observed_at from raw_observations
       where provider_id = $1 and company_id = $2
         and observed_at < (select started_at from provider_runs where id = $3)
       order by observed_at desc limit 500`,
      [provider.providerId, target.companyId, runId],
    );

    const candidates = await provider.normalize(
      withNovelty.map(({ payload, isNew }) => ({ payload, isNew })),
      history.map((h) => ({ payload: h.raw_payload, observedAt: h.observed_at })),
      target,
    );

    let evidenceCreated = 0;
    let signalsCreated = 0;
    for (const c of candidates) {
      const observedAt = c.observedAt ?? new Date();

      // §26 duplication rule: the SAME provider re-asserting the SAME claim
      // about the SAME company is not new evidence — one logical event.
      // (A DIFFERENT provider making the claim IS corroboration and passes.)
      const fp = claimFingerprint(target.companyId, c.claim);
      const { rows: dupRows } = await db.query<{ id: string }>(
        `select id from evidence
         where company_id = $1 and provider_id = $2 and claim_fingerprint = $3
         limit 1`,
        [target.companyId, provider.providerId, fp],
      );
      if (dupRows.length > 0) continue;

      const { rows: evRows } = await db.query<{ id: string }>(
        `insert into evidence (org_id, company_id, source_type, source_url, claim, raw_excerpt,
            confidence, observed_at, provider_id, first_party, published_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          target.orgId, target.companyId, provider.providerId, c.sourceUrl ?? null,
          c.claim, c.excerpt ?? c.claim, c.confidence, observedAt,
          provider.providerId, c.firstParty, c.publishedAt ?? null,
        ],
      );
      const outcome = await verifyEvidence(
        db,
        {
          id: evRows[0].id,
          orgId: target.orgId,
          companyId: target.companyId,
          sourceName: provider.providerId,
          claim: c.claim,
          rawExcerpt: c.excerpt ?? c.claim,
          observedAt,
          extractionConfidence: c.confidence,
        },
        // Deterministic providers quote structured records verbatim; the
        // model cross-check runs only when an LLM produced the claim.
        c.excerpt && c.excerpt !== c.claim ? { crossCheck: crossCheckLLM } : {},
      );
      evidenceCreated++;

      // Provider-suggested signals: honored ONLY for verified evidence and
      // ONLY when the type exists in the central registry.
      if (outcome.status === "verified" && c.suggestedSignalType) {
        const def = SIGNAL_DEFS[c.suggestedSignalType];
        if (def) {
          const { rows: nodeRows } = c.suggestedNodeSlug
            ? await db.query<{ id: string }>(`select id from taxonomy_nodes where slug = $1`, [
                c.suggestedNodeSlug,
              ])
            : { rows: [] as { id: string }[] };
          await db.query(
            `insert into signals (org_id, company_id, signal_type, taxonomy_node_id, direction,
                magnitude, confidence, observed_at, half_life_days, evidence_id, first_seen, last_seen)
             values ($1, $2, $3, $4, $5, $6,
                (select computed_confidence from evidence where id = $7), $8, $9, $7, $8, $8)`,
            [
              target.orgId, target.companyId, c.suggestedSignalType,
              nodeRows[0]?.id ?? null, def.direction, 1, evRows[0].id,
              observedAt, def.halfLifeDays,
            ],
          );
          signalsCreated++;
        }
      }
    }

    await finish({
      status: "succeeded",
      records_received: observations.length,
      evidence_created: evidenceCreated,
      signals_created: signalsCreated,
    });
    return {
      runId, status: "succeeded",
      recordsReceived: observations.length, newObservations: newCount,
      evidenceCreated, signalsCreated,
    };
  } catch (err) {
    // One failed provider must never block the rest (§23).
    const msg = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: msg.slice(0, 500) });
    return { runId, status: "failed", recordsReceived: 0, newObservations: 0, evidenceCreated: 0, signalsCreated: 0, error: msg };
  }
}
