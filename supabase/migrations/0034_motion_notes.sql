-- 0034 Operator notes on motions: free-form human guidance that the AI reads.
-- Notes ride into the campaign generator's grounding context alongside the
-- thesis and verified evidence, so what the operator knows ("their CFO owns
-- this decision", "don't mention the migration until Q2") steers every draft.
alter table revenue_motions add column if not exists operator_notes text;
