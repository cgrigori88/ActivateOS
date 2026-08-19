-- Guest seats (B+2, task #81). A partnership invite can now mint a FREE
-- scoped tenant for the counterpart: organizations carry a kind, and 'guest'
-- workspaces are capped in app code (no partnership invites of their own)
-- with an upgrade path. Everything else about a guest org is a normal tenant
-- — same RLS, same consent fabric, same rooms.
alter table organizations
  add column if not exists kind text not null default 'full'
  check (kind in ('full', 'guest'));
