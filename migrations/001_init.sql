-- Rigo initial schema. All tables live in the "rigo" schema so they are never exposed
-- through a hosted database's public REST API. Every company-owned row carries company_id.

create schema if not exists rigo;

-- ---------------------------------------------------------------- identity
create table rigo.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  theme text not null default 'light' check (theme in ('light','dark','system')),
  created_at timestamptz not null default now()
);
create unique index users_email_key on rigo.users (lower(email));

create table rigo.sessions (
  id text primary key,                       -- sha-256 of the opaque cookie token
  user_id uuid not null references rigo.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on rigo.sessions (user_id);

create table rigo.password_resets (
  token_hash text primary key,
  user_id uuid not null references rigo.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table rigo.auth_attempts (
  key text not null,
  at timestamptz not null default now()
);
create index auth_attempts_key_idx on rigo.auth_attempts (key, at);

-- ---------------------------------------------------------------- companies
create table rigo.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'real' check (kind in ('real','demo')),
  demo_user_id uuid references rigo.users(id) on delete cascade,
  timezone text not null default 'America/New_York',
  currency text not null default 'USD',
  phone text, email text, address text,
  service_categories text[] not null default '{}',
  automation_mode text not null default 'assisted' check (automation_mode in ('manual','assisted','automatic')),
  paused boolean not null default false,
  paused_at timestamptz, paused_by uuid references rigo.users(id),
  branding jsonb not null default '{}'::jsonb,       -- {accent, logoFileId}
  settings jsonb not null default '{}'::jsonb,       -- setup progress, custom fields, demo guide, invoice settings
  config_version integer not null default 1,
  job_seq integer not null default 0,
  invoice_seq integer not null default 0,
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now()
);
create unique index companies_one_demo_per_user on rigo.companies (demo_user_id) where kind = 'demo';

create table rigo.roles (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  key text not null,
  name text not null,
  description text not null default '',
  permissions text[] not null default '{}',
  is_owner boolean not null default false,
  primary key (company_id, key)
);

create table rigo.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  user_id uuid not null references rigo.users(id) on delete cascade,
  role_key text not null,
  status text not null default 'active' check (status in ('active','removed')),
  display_name text,                       -- demo personas
  is_fictional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id),
  foreign key (company_id, role_key) references rigo.roles(company_id, key)
);
create index memberships_user_idx on rigo.memberships (user_id) where status = 'active';

create table rigo.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  email text not null,
  role_key text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','replaced')),
  expires_at timestamptz not null,
  invited_by uuid references rigo.users(id),
  accepted_by uuid references rigo.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (company_id, role_key) references rigo.roles(company_id, key)
);
create unique index invitations_one_pending on rigo.invitations (company_id, lower(email)) where status = 'pending';

create table rigo.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  from_user_id uuid not null references rigo.users(id) on delete cascade,
  to_user_id uuid not null references rigo.users(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- business records
create table rigo.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  email text, phone text,
  billing_address text,
  notes text not null default '',
  custom jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_company_idx on rigo.customers (company_id, lower(name));

create table rigo.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  customer_id uuid not null references rigo.customers(id) on delete cascade,
  label text not null default '',
  address text not null,
  access_instructions text not null default '',
  site_contact text not null default '',
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index locations_customer_idx on rigo.locations (company_id, customer_id);

create table rigo.resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  kind text not null check (kind in ('truck','equipment','unit')),
  name text not null,
  identifier text not null default '',
  capacity text not null default '',
  status text not null default 'available' check (status in ('available','in_service','out_of_service','retired')),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table rigo.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  category text not null check (category in ('fuel','portable_toilet','septic','other')),
  description text not null default '',
  fields jsonb not null default '[]'::jsonb,       -- declarative field definitions
  pricing jsonb not null default '[]'::jsonb,      -- price lines; a null rate means "not set"
  tax_rate_bp integer,                             -- basis points; null = no tax configured
  requires_photo boolean not null default false,
  requires_signature boolean not null default false,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table rigo.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  number integer not null,
  customer_id uuid references rigo.customers(id),
  location_id uuid references rigo.locations(id),
  service_id uuid references rigo.services(id),
  status text not null default 'draft'
    check (status in ('draft','open','in_progress','completed','partial','unsuccessful','cancelled')),
  assigned_user_id uuid references rigo.users(id),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  contact_name text not null default '',
  contact_phone text not null default '',
  access_instructions text not null default '',
  notes text not null default '',
  details jsonb not null default '{}'::jsonb,       -- requested service field values
  completion jsonb,                                 -- server-accepted completion record
  completion_submission_id text,
  billing_status text not null default 'not_ready'
    check (billing_status in ('not_ready','not_billable','ready','held','drafted','approved','issued')),
  problem_open boolean not null default false,
  recurring_plan_id uuid,
  version integer not null default 1,
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (company_id, number)
);
create index jobs_company_status_idx on rigo.jobs (company_id, status);
create index jobs_assignee_idx on rigo.jobs (company_id, assigned_user_id);
create index jobs_schedule_idx on rigo.jobs (company_id, scheduled_start);

create table rigo.job_resources (
  job_id uuid not null references rigo.jobs(id) on delete cascade,
  resource_id uuid not null references rigo.resources(id) on delete cascade,
  company_id uuid not null references rigo.companies(id) on delete cascade,
  primary key (job_id, resource_id)
);

create table rigo.job_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  job_id uuid not null references rigo.jobs(id) on delete cascade,
  type text not null,
  actor_user_id uuid references rigo.users(id),
  actor_label text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index job_events_job_idx on rigo.job_events (job_id, created_at);

create table rigo.files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  subject_type text not null,          -- job | company | sample
  subject_id uuid,
  name text not null,
  mime text not null,
  size integer not null,
  storage text not null check (storage in ('local','database')),
  storage_key text,
  data bytea,
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- invoicing
create table rigo.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  number text,                                     -- assigned when issued
  billable_key text not null,                      -- one invoice per billable event
  customer_id uuid references rigo.customers(id),
  job_id uuid references rigo.jobs(id),
  recurring_plan_id uuid,
  status text not null default 'draft'
    check (status in ('held','draft','pending_approval','approved','issued','void')),
  delivery_status text not null default 'not_prepared'
    check (delivery_status in ('not_prepared','prepared','simulated','queued','sent','delivered','failed')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  currency text not null,
  subtotal_minor bigint, discount_minor bigint, tax_minor bigint, total_minor bigint,
  paid_minor bigint not null default 0,
  hold_reasons jsonb not null default '[]'::jsonb,
  notes text not null default '',
  due_days integer not null default 30,
  issued_at timestamptz,
  approved_by uuid references rigo.users(id),
  approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, billable_key),
  unique (company_id, number)
);

create table rigo.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references rigo.invoices(id) on delete cascade,
  company_id uuid not null references rigo.companies(id) on delete cascade,
  position integer not null,
  description text not null,
  quantity numeric not null,
  unit text not null default '',
  rate_minor bigint,                                -- null = rate missing (invoice is held)
  amount_minor bigint,
  taxable boolean not null default false,
  kind text not null default 'charge' check (kind in ('charge','discount'))
);

create table rigo.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  invoice_id uuid not null references rigo.invoices(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  method text not null default 'other',
  note text not null default '',
  recorded_by uuid references rigo.users(id),
  recorded_at timestamptz not null default now(),
  idempotency_key text not null,
  unique (company_id, idempotency_key)
);

-- ---------------------------------------------------------------- communications
create table rigo.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  customer_id uuid references rigo.customers(id),
  job_id uuid references rigo.jobs(id),
  invoice_id uuid references rigo.invoices(id),
  channel text not null check (channel in ('email','sms')),
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  recipient text not null default '',
  subject text not null default '',
  body text not null,
  status text not null default 'prepared'
    check (status in ('prepared','simulated','queued','sent','delivered','failed','replied')),
  status_detail text not null default '',
  provider text not null default 'none',
  source_key text,                                 -- idempotency key of the action that prepared it
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index messages_source_key on rigo.messages (company_id, source_key) where source_key is not null;

create table rigo.dev_mailbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  link text,
  kind text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- workflows & automation
create table rigo.workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  description text not null default '',
  active_version_id uuid,
  paused boolean not null default false,
  mode_override text check (mode_override in ('manual','assisted','automatic')),
  created_at timestamptz not null default now()
);

create table rigo.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references rigo.workflows(id) on delete cascade,
  company_id uuid not null references rigo.companies(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','tested','active','retired','proposal')),
  source text not null default 'form' check (source in ('form','visual','assistant','template','system')),
  definition jsonb not null,
  definition_hash text not null,
  validation jsonb not null default '{}'::jsonb,
  test_result jsonb,
  tested_hash text,
  created_by uuid references rigo.users(id),
  activated_by uuid references rigo.users(id),
  created_at timestamptz not null default now(),
  tested_at timestamptz,
  activated_at timestamptz,
  unique (workflow_id, version)
);

create table rigo.events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  type text not null,
  subject_type text not null,
  subject_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  depth integer not null default 0,
  actor_user_id uuid references rigo.users(id),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index events_unprocessed_idx on rigo.events (created_at) where processed_at is null;

create table rigo.automation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  workflow_id uuid not null references rigo.workflows(id) on delete cascade,
  workflow_version_id uuid not null references rigo.workflow_versions(id) on delete cascade,
  event_id uuid references rigo.events(id) on delete set null,
  subject_type text not null,
  subject_id uuid not null,
  status text not null default 'running'
    check (status in ('running','waiting','completed','failed','blocked','cancelled','taken_over')),
  current_step integer not null default 0,
  depth integer not null default 0,
  idempotency_key text not null,
  summary text not null default '',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);

create table rigo.actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  run_id uuid references rigo.automation_runs(id) on delete cascade,
  step_id text,
  step_index integer,
  type text not null,
  status text not null
    check (status in ('suggested','proposed','waiting_approval','queued','running','completed','simulated','failed','blocked','rejected','cancelled')),
  mode text not null,
  subject_type text not null,
  subject_id uuid not null,
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  explanation text not null default '',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz,
  idempotency_key text not null,
  run_as_user_id uuid references rigo.users(id),
  executed_by text not null default 'rigo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);
create index actions_status_idx on rigo.actions (company_id, status);

create table rigo.approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  action_id uuid not null references rigo.actions(id) on delete cascade,
  title text not null,
  consequence text not null,
  subject_type text not null,
  subject_id uuid not null,
  subject_version integer not null,
  workflow_version_id uuid references rigo.workflow_versions(id) on delete set null,
  input_hash text not null,
  approver_user_ids uuid[] not null default '{}',
  approver_roles text[] not null default '{}',
  backup_user_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected','stale','cancelled')),
  escalate_at timestamptz,
  escalated_at timestamptz,
  decided_by uuid references rigo.users(id),
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);
create index approvals_pending_idx on rigo.approvals (company_id) where status = 'pending';

create table rigo.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  user_id uuid not null references rigo.users(id) on delete cascade,
  category text not null check (category in ('needs_action','warning','update')),
  title text not null,
  body text not null default '',
  link text,
  ref_type text, ref_id uuid,
  dedupe_key text,
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on rigo.notifications (company_id, user_id, created_at desc);
create unique index notifications_dedupe on rigo.notifications (company_id, user_id, dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------- recurring service & rentals
create table rigo.recurring_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('service','rental')),
  customer_id uuid not null references rigo.customers(id),
  location_id uuid references rigo.locations(id),
  service_id uuid not null references rigo.services(id),
  visit_rule jsonb not null,           -- {frequency, interval, weekdays, time, durationMinutes}
  billing_rule jsonb not null,         -- {frequency: none|per_visit|weekly|monthly, rateMinor, description}
  units integer not null default 1,
  starts_on date not null,
  ends_on date,
  paused_from date, paused_until date,
  status text not null default 'active' check (status in ('active','paused','ended')),
  generated_through date,
  billed_through date,
  details jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table rigo.plan_occurrences (
  plan_id uuid not null references rigo.recurring_plans(id) on delete cascade,
  occurrence_date date not null,
  company_id uuid not null references rigo.companies(id) on delete cascade,
  job_id uuid references rigo.jobs(id) on delete set null,
  state text not null default 'scheduled' check (state in ('scheduled','skipped_paused','cancelled')),
  primary key (plan_id, occurrence_date)
);

-- ---------------------------------------------------------------- imports & templates
create table rigo.imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  kind text not null check (kind in ('customers','resources')),
  file_name text not null,
  status text not null default 'uploaded' check (status in ('uploaded','reviewed','committed','failed','discarded')),
  headers jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  mapping jsonb not null default '{}'::jsonb,
  review jsonb,
  result jsonb,
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table rigo.templates (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references rigo.users(id) on delete cascade,
  source_company_id uuid references rigo.companies(id) on delete set null,
  name text not null,
  description text not null default '',
  visibility text not null default 'private' check (visibility in ('private','shared','public','system')),
  content jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rigo.template_shares (
  template_id uuid not null references rigo.templates(id) on delete cascade,
  email text not null,
  primary key (template_id, email)
);

create table rigo.template_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  template_id uuid references rigo.templates(id) on delete set null,
  template_name text not null,
  template_version integer not null,
  applied_by uuid references rigo.users(id),
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- assistant & audit
create table rigo.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  user_id uuid not null references rigo.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  source text not null default 'prepared' check (source in ('prepared','ai','user')),
  proposal jsonb,
  created_at timestamptz not null default now()
);

create table rigo.usage_counters (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  kind text not null,
  day date not null,
  count integer not null default 0,
  primary key (company_id, kind, day)
);

create table rigo.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references rigo.companies(id) on delete cascade,
  actor_user_id uuid references rigo.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_company_idx on rigo.audit_log (company_id, created_at desc);

create table rigo.system_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Hosted Postgres (e.g. Supabase) exposes some roles to a public API; never grant them this schema.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema rigo from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema rigo from authenticated';
  end if;
end $$;
