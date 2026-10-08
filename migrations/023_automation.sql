-- Rebuild, step 7: assisted automation. Rigo prepares, a person approves; owners can switch each
-- automation to Manual or Automatic, pause everything and take over. Nothing approves itself.

-- The level of each automation in a workspace (the workspace level is companies.automation_mode).
create table rigo.auto_rules (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  key text not null,
  level text not null check (level in ('off','manual','assisted','automatic')),
  updated_by uuid references rigo.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);

-- What Rigo prepared or did, and what people decided. The approvals inbox reads the waiting ones.
create table rigo.auto_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  rule_key text not null,
  level text not null check (level in ('manual','assisted','automatic')),
  kind text not null check (kind in ('invoice','message')),
  subject_type text not null,              -- invoice | message | work
  subject_id uuid,
  title text not null,
  summary text not null default '',
  status text not null default 'waiting' check (status in ('suggested','waiting','approved','rejected','done','failed','cancelled','taken_over','paused')),
  dedupe_key text not null,
  result jsonb not null default '{}'::jsonb,
  decided_by uuid references rigo.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);
create index auto_actions_company_idx on rigo.auto_actions (company_id, status, created_at desc);

-- Messages to customers. Always prepared first; "sent" only when a provider accepted it.
create table rigo.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  client_id uuid references rigo.clients(id) on delete set null,
  work_id uuid references rigo.work_items(id) on delete set null,
  invoice_id uuid references rigo.money_invoices(id) on delete set null,
  channel text not null check (channel in ('email','sms')),
  recipient text not null default '',
  subject text not null default '',
  body text not null,
  status text not null default 'prepared' check (status in ('prepared','sent','simulated','blocked','failed','cancelled')),
  detail text not null default '',
  provider text not null default '',
  created_by uuid references rigo.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbox_messages_company_idx on rigo.outbox_messages (company_id, created_at desc);
