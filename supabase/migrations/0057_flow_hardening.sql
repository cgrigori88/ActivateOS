-- 0057: Erasure-path FK fix (security-audit RISK-4). joint_playbooks.updated_by_org
-- was ON DELETE NO ACTION, so deleting an organization either blocked on or
-- orphaned this pointer. Make it null out on delete — the playbook content is
-- co-owned and survives; only the "last edited by" attribution clears.

alter table joint_playbooks drop constraint if exists joint_playbooks_updated_by_org_fkey;
alter table joint_playbooks
  add constraint joint_playbooks_updated_by_org_fkey
  foreign key (updated_by_org) references organizations(id) on delete set null;
