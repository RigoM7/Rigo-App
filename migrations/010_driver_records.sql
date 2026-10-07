-- WP5: work recorded on a phone is never lost when a job is reassigned or a driver is removed.

-- When a membership ended. A removed driver may still send records they made while assigned, for 7 days (D12).
alter table rigo.memberships add column if not exists removed_at timestamptz;
update rigo.memberships set removed_at = updated_at where status = 'removed' and removed_at is null;

-- A record that can't be applied directly (the job moved to someone else, was already finished, or the
-- driver was removed) waits here for the office to accept or dismiss it. Photos are stored as job files.
create table if not exists rigo.pending_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  job_id uuid not null references rigo.jobs(id) on delete cascade,
  user_id uuid not null references rigo.users(id) on delete cascade,
  submission_id text not null,
  reason text not null check (reason in ('reassigned','finished','removed')),
  payload jsonb not null,
  problems jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  decided_by uuid references rigo.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, submission_id)
);
create index if not exists pending_submissions_open_idx on rigo.pending_submissions (company_id, created_at) where status = 'pending';
