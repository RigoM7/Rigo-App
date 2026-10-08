-- Rebuild, step 4: customers, equipment, the price list and the main work record, for any business.
-- New tables only; every row carries company_id and every query is scoped by it.

create table rigo.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  notes text not null default '',
  fields jsonb not null default '{}'::jsonb,
  tax_exempt boolean not null default false,
  archived_at timestamptz,
  version integer not null default 1,
  created_by uuid references rigo.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_company_idx on rigo.clients (company_id, lower(name));

-- Places where work happens for a customer (sites, homes, delivery addresses).
create table rigo.client_places (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  client_id uuid not null references rigo.clients(id) on delete cascade,
  label text not null default '',
  address text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index client_places_client_idx on rigo.client_places (company_id, client_id);

-- More people to reach at a customer (billing, site contact, a parent).
create table rigo.client_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  client_id uuid not null references rigo.clients(id) on delete cascade,
  name text not null,
  label text not null default '',
  email text,
  phone text,
  created_at timestamptz not null default now()
);
create index client_contacts_client_idx on rigo.client_contacts (company_id, client_id);

create table rigo.equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  identifier text not null default '',
  status text not null default 'available' check (status in ('available','out_of_service','retired')),
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index equipment_company_idx on rigo.equipment (company_id);

-- What the workspace sells, with its price. A null rate means "not set yet": invoices using it are held.
create table rigo.catalog_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  unit text not null default '',
  rate_e4 bigint,                          -- ten-thousandths of the currency unit
  taxable boolean not null default false,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index catalog_items_company_idx on rigo.catalog_items (company_id, position);

-- The main work record (each workspace names it: job, appointment, order, visit).
create table rigo.work_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  number integer not null,
  title text not null default '',
  client_id uuid references rigo.clients(id),
  place_id uuid references rigo.client_places(id),
  stage_id uuid not null references rigo.stages(id),
  starts_at timestamptz,
  ends_at timestamptz,
  notes text not null default '',
  fields jsonb not null default '{}'::jsonb,
  source text not null default 'staff' check (source in ('staff','request','booking','import','repeat','sample')),
  billing text not null default 'none' check (billing in ('none','ready','invoiced','not_billable')),
  version integer not null default 1,
  created_by uuid references rigo.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (company_id, number)
);
create index work_items_schedule_idx on rigo.work_items (company_id, starts_at);
create index work_items_stage_idx on rigo.work_items (company_id, stage_id);
create index work_items_client_idx on rigo.work_items (company_id, client_id);

create table rigo.work_assignees (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  work_id uuid not null references rigo.work_items(id) on delete cascade,
  user_id uuid not null references rigo.users(id) on delete cascade,
  primary key (work_id, user_id)
);
create index work_assignees_user_idx on rigo.work_assignees (company_id, user_id);

create table rigo.work_equipment (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  work_id uuid not null references rigo.work_items(id) on delete cascade,
  equipment_id uuid not null references rigo.equipment(id) on delete cascade,
  primary key (work_id, equipment_id)
);

-- What the work charges for: billed exactly as recorded here.
create table rigo.work_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  work_id uuid not null references rigo.work_items(id) on delete cascade,
  catalog_id uuid references rigo.catalog_items(id) on delete set null,
  description text not null,
  quantity text not null default '1',     -- an exact decimal, as typed
  unit text not null default '',
  rate_e4 bigint,
  taxable boolean not null default false,
  position integer not null default 0
);
create index work_lines_work_idx on rigo.work_lines (work_id);

create table rigo.work_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  work_id uuid not null references rigo.work_items(id) on delete cascade,
  type text not null,
  actor_user_id uuid references rigo.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()   -- ordered within one transaction
);
create index work_history_work_idx on rigo.work_history (work_id, created_at);

-- Records sent from a worker's phone, so a record sent twice (offline retries) is applied once.
create table rigo.worker_submissions (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  submission_id text not null,
  work_id uuid not null references rigo.work_items(id) on delete cascade,
  user_id uuid not null references rigo.users(id) on delete cascade,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (company_id, submission_id)
);

-- Tax for taxable lines, set per workspace (basis points; null: not set, so taxable work is held).
alter table rigo.companies add column if not exists tax_rate_bp integer;
