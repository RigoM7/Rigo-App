-- WP7: invitations say honestly how they were delivered, and a pending invitation's link can be
-- copied again. The link only works for the invited email address and is cleared once the invitation
-- is used, revoked or replaced.
alter table rigo.invitations add column if not exists link_token text;
alter table rigo.invitations add column if not exists delivery text not null default '';
