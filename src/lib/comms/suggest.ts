import type pg from "pg";
import { generateCampaignSequence } from "../agents/campaign-email";

/**
 * AI campaign suggestions (Phase 9B.2). For active/approved motions that don't
 * yet have a live campaign, the pipeline drafts one and tags it 'ai_suggested'.
 * Everything lands as draft — the human reviews, edits, schedules, and launches
 * (or dismisses). The pipeline proposes; it never sends.
 *
 * Bounded by design: generation costs a frontier call each, so callers cap how
 * many suggestions to draft per run.
 */
export async function suggestCampaigns(
  db: pg.PoolClient,
  args: { orgId?: string | null; limit?: number; senderName?: string; touchCount?: number },
): Promise<{ suggested: number; campaignIds: string[] }> {
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
  const { rows: motions } = await db.query<{ id: string }>(
    `select m.id
     from revenue_motions m
     where m.status in ('approved', 'active')
       and ($1::uuid is null or m.org_id = $1)
       and not exists (
         select 1 from campaigns ca
         where ca.motion_id = m.id and ca.dismissed_at is null
       )
     order by m.created_at desc
     limit $2`,
    [args.orgId ?? null, limit],
  );

  const campaignIds: string[] = [];
  for (const m of motions) {
    try {
      const { campaignId } = await generateCampaignSequence(db, {
        motionId: m.id,
        senderName: args.senderName ?? "The PursuitOS Team",
        touchCount: args.touchCount ?? 3,
        source: "ai_suggested",
      });
      campaignIds.push(campaignId);
    } catch {
      // A single motion failing to draft never blocks the rest.
    }
  }
  return { suggested: campaignIds.length, campaignIds };
}
