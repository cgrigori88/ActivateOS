import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { z } from "zod";
import { completeStructured } from "../ai/client";
import { SIGNAL_DEFS, SIGNAL_TYPES } from "../signals/types";

/**
 * Taxonomy Mapper (docs/AGENT_LAYER.md §3): verified evidence → typed signals
 * on ontology nodes. Deterministic product-map matching runs first (free,
 * exact); only unmatched claims go to the cheap-tier model, constrained to
 * the known signal-type and node-slug enums. Signals inherit the registry's
 * half-life and direction — the model never invents decay rates.
 */

interface ProductMap {
  patterns: { match: string[]; node: string }[];
}

export function matchProductToNode(product: string, map: ProductMap): string | null {
  const p = product.toLowerCase();
  for (const entry of map.patterns) {
    if (entry.match.some((m) => p.includes(m))) return entry.node;
  }
  return null;
}

export function loadProductMap(): ProductMap {
  return JSON.parse(
    readFileSync(join(process.cwd(), "knowledge", "ontology", "product-map.json"), "utf8"),
  ) as ProductMap;
}

const INSTALLED_PRODUCT_PREFIX = "Customer-reported installed product: ";

export interface MapStats {
  mappedDeterministic: number;
  mappedLLM: number;
  skipped: number;
}

interface EvidenceRow {
  id: string;
  org_id: string | null;
  company_id: string;
  claim: string;
  computed_confidence: number;
  observed_at: Date;
  source_type: string;
}

const EVENT_PASSED_GRACE_DAYS = 90;

/**
 * Parse a model-provided event date defensively: must be a real calendar date
 * within a plausible commercial window (not years in the past, not a decade
 * out). Returns null rather than trusting junk — the signal still counts, it
 * just doesn't get event-anchored relevance.
 */
export function parseEventDate(raw: string | null | undefined, now: Date = new Date()): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days < -365 || days > 5 * 365) return null;
  return d;
}

async function insertSignal(
  db: pg.PoolClient,
  e: EvidenceRow,
  signalType: string,
  nodeId: string | null,
  magnitude: number,
  eventDate: Date | null = null,
): Promise<void> {
  const def = SIGNAL_DEFS[signalType];
  const expiresAt = eventDate
    ? new Date(eventDate.getTime() + EVENT_PASSED_GRACE_DAYS * 86_400_000)
    : null;
  await db.query(
    `insert into signals (org_id, company_id, signal_type, taxonomy_node_id, direction,
                          magnitude, confidence, observed_at, half_life_days, evidence_id,
                          value, expires_at, first_seen, last_seen)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $8, $8)`,
    [
      e.org_id,
      e.company_id,
      signalType,
      nodeId,
      def.direction,
      magnitude,
      e.computed_confidence,
      e.observed_at,
      def.halfLifeDays,
      e.id,
      eventDate ? JSON.stringify({ event_date: eventDate.toISOString().slice(0, 10) }) : null,
      expiresAt,
    ],
  );
}

/**
 * Map all verified, not-yet-mapped evidence for an org into signals.
 * `useLLM: false` runs the deterministic path only (no API key required).
 */
export async function mapSignals(
  db: pg.PoolClient,
  orgId: string,
  opts: { useLLM: boolean },
): Promise<MapStats> {
  const stats: MapStats = { mappedDeterministic: 0, mappedLLM: 0, skipped: 0 };
  const productMap = loadProductMap();

  const { rows: nodes } = await db.query<{ id: string; slug: string }>(
    `select id, slug from taxonomy_nodes`,
  );
  const nodeIdBySlug = new Map(nodes.map((n) => [n.slug, n.id]));
  const nodeSlugs = nodes.map((n) => n.slug) as [string, ...string[]];

  const { rows: unmapped } = await db.query<EvidenceRow>(
    `select e.id, e.org_id, e.company_id, e.claim, e.computed_confidence, e.observed_at, e.source_type
     from evidence e
     where e.org_id = $1 and e.status = 'verified'
       and not exists (select 1 from signals s where s.evidence_id = e.id)`,
    [orgId],
  );

  for (const e of unmapped) {
    // Deterministic path: customer-reported installed products.
    if (e.claim.startsWith(INSTALLED_PRODUCT_PREFIX)) {
      const product = e.claim.slice(INSTALLED_PRODUCT_PREFIX.length);
      const nodeSlug = matchProductToNode(product, productMap);
      if (nodeSlug && nodeIdBySlug.has(nodeSlug)) {
        await insertSignal(db, e, "TECH_INSTALLED", nodeIdBySlug.get(nodeSlug)!, 1);
        stats.mappedDeterministic++;
        continue;
      }
    }

    if (!opts.useLLM) {
      stats.skipped++;
      continue;
    }

    const classification = await completeStructured({
      tier: "cheap",
      system:
        `You classify evidence claims about companies into signals for a channel-revenue ` +
        `propensity engine. Choose the single best signal type and, when the claim concerns a ` +
        `specific technology area, the best ontology node. Set relevant=false for claims that ` +
        `do not indicate any commercial signal. Magnitude reflects strength: a single job ` +
        `posting ~0.3, a major stated initiative ~0.9. If the claim names a specific future ` +
        `event date or period (a renewal, expiry, refresh, or fiscal deadline), give its ` +
        `approximate ISO date (use the middle of a named quarter or year); otherwise null. ` +
        `Today is ${e.observed_at.toISOString().slice(0, 10)}.`,
      user: `Claim: ${e.claim}`,
      schema: z.object({
        relevant: z.boolean(),
        signal_type: z.enum(SIGNAL_TYPES),
        node_slug: z.enum(nodeSlugs).nullable(),
        magnitude: z.number().min(0).max(1),
        event_date: z
          .string()
          .nullable()
          .describe("ISO date (YYYY-MM-DD) of the future event the claim anchors to, or null"),
      }),
      maxTokens: 512,
    });

    if (!classification.relevant || !SIGNAL_DEFS[classification.signal_type]) {
      stats.skipped++;
      continue;
    }
    const nodeId = classification.node_slug
      ? (nodeIdBySlug.get(classification.node_slug) ?? null)
      : null;
    await insertSignal(
      db,
      e,
      classification.signal_type,
      nodeId,
      classification.magnitude,
      parseEventDate(classification.event_date, e.observed_at),
    );
    stats.mappedLLM++;
  }

  return stats;
}
