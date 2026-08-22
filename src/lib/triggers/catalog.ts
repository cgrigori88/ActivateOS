import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Attention-trigger catalog (task #83, GTM-OS batch slice 2).
 *
 * Every deterministic "this deserves attention" rule in the product is named
 * here — one key per rule, documented, versioned in code. The org's toggles
 * live in trigger_settings (absent row = enabled), so the catalog is the
 * contract and the table is just preferences. Surfaces list where a trigger
 * shows up so turning one off is an informed choice, not a mystery switch.
 */

export type TriggerKey =
  | "renewal_window"
  | "stale_deal"
  | "engagement_decay"
  | "joint_room_gap"
  | "motion_stalled"
  | "crm_divergence";

export interface TriggerDef {
  key: TriggerKey;
  label: string;
  description: string;
  surfaces: string[];
}

export const TRIGGER_CATALOG: TriggerDef[] = [
  {
    key: "renewal_window",
    label: "Renewal window",
    description:
      "A renewal date from an approved list is approaching with the clock running — surfaced before coverage exists, not after it lapses.",
    surfaces: ["Today next actions", "Pipeline renewal radar", "Account digests", "Systems-disagree card"],
  },
  {
    key: "stale_deal",
    label: "Stale deal",
    description: "An open opportunity untouched for 21+ days — the record and the deal have parted ways.",
    surfaces: ["Systems-disagree card", "deal_context (agents)"],
  },
  {
    key: "engagement_decay",
    label: "Late stage, silent engagement",
    description: "A proposal- or negotiation-stage deal with no engagement in 30+ days — late-stage on paper, quiet in reality.",
    surfaces: ["Systems-disagree card", "deal_context (agents)"],
  },
  {
    key: "joint_room_gap",
    label: "Joint room without pipeline",
    description:
      "An active joint pursuit with a partner where your own pipeline holds no open opportunity — the two sides of the deal disagree.",
    surfaces: ["Systems-disagree card", "deal_context (agents)"],
  },
  {
    key: "motion_stalled",
    label: "Motion stalled",
    description: "An active motion with nothing sent in 14+ days — the plan says moving, the outbox says stopped.",
    surfaces: ["Systems-disagree card", "deal_context (agents)"],
  },
  {
    key: "crm_divergence",
    label: "CRM disagrees with the platform",
    description:
      "The latest CRM export reports a different stage, or an amount more than 20% apart, from the live record — two systems, two stories.",
    surfaces: ["Systems-disagree card", "deal_context (agents)"],
  },
];

const ALL_KEYS = TRIGGER_CATALOG.map((t) => t.key);

export function isTriggerKey(v: string): v is TriggerKey {
  return (ALL_KEYS as string[]).includes(v);
}

/** The org's enabled trigger keys. Absent row = enabled (default on). */
export async function enabledTriggers(db: Db, orgId: string | null): Promise<Set<TriggerKey>> {
  const enabled = new Set<TriggerKey>(ALL_KEYS);
  if (!orgId) return enabled;
  const { rows } = await db.query<{ trigger_key: string }>(
    `select trigger_key from trigger_settings where org_id = $1 and enabled = false`,
    [orgId],
  );
  for (const r of rows) if (isTriggerKey(r.trigger_key)) enabled.delete(r.trigger_key);
  return enabled;
}

export async function setTriggerEnabled(db: Db, orgId: string, key: TriggerKey, enabled: boolean): Promise<void> {
  await db.query(
    `insert into trigger_settings (org_id, trigger_key, enabled) values ($1, $2, $3)
     on conflict (org_id, trigger_key) do update set enabled = excluded.enabled, updated_at = now()`,
    [orgId, key, enabled],
  );
}
