-- Rebuild, step 8: public booking and request pages, and the shared template library.

-- A workspace's public page: customers ask for work (request) or pick a time (book).
create table rigo.booking_pages (
  company_id uuid primary key references rigo.companies(id) on delete cascade,
  slug text not null unique,
  enabled boolean not null default false,
  mode text not null default 'request' check (mode in ('request','book')),
  headline text not null default '',
  intro text not null default '',
  catalog_ids uuid[] not null default '{}',
  hours jsonb,                               -- days and times bookings may start
  slot_minutes integer not null default 60,
  updated_at timestamptz not null default now()
);

-- What came in from the public page. Lands in the inbox; a person accepts or declines it.
create table rigo.requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text not null default '',
  message text not null default '',
  wanted text not null default '',           -- the price-list item asked for, by name
  catalog_id uuid references rigo.catalog_items(id) on delete set null,
  preferred_at timestamptz,
  status text not null default 'new' check (status in ('new','accepted','declined')),
  work_id uuid references rigo.work_items(id) on delete set null,
  client_id uuid references rigo.clients(id) on delete set null,
  sender_key text not null default '',       -- hashed address, for rate limits only
  decided_by uuid references rigo.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index requests_company_idx on rigo.requests (company_id, status, created_at desc);

-- Templates owners publish for other Rigo users: structure only, never prices, people or records.
create table rigo.library_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references rigo.companies(id) on delete set null,
  published_by uuid references rigo.users(id) on delete set null,
  name text not null,
  blurb text not null default '',
  examples text[] not null default '{}',
  structure jsonb not null,
  uses integer not null default 0,
  unpublished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index library_templates_live_idx on rigo.library_templates (created_at desc) where unpublished_at is null;
