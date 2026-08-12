-- Phase 10: field selection on review. When a pushed partner list is accepted,
-- the reviewer chooses which of its fields carry into the mapped matrix.
-- null = show all detected fields.
alter table account_populations add column if not exists selected_fields text[];
