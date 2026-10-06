-- Round 2: job priority. Urgent and emergency jobs sort first within a day, show a pill everywhere
-- the job appears, and unassigned ones are counted in Home's "Needs you". Existing jobs stay normal.
alter table rigo.jobs
  add column priority text not null default 'normal' check (priority in ('normal','urgent','emergency'));
create index jobs_company_priority_idx on rigo.jobs (company_id, priority) where priority <> 'normal';
