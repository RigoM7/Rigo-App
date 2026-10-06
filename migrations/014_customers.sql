-- WP8: customers. Archive and merge (with undo), a billing contact, a site contact phone, a bill-to
-- customer on jobs, and accent- and format-insensitive search without database extensions.

alter table rigo.customers add column if not exists archived_at timestamptz;
alter table rigo.customers add column if not exists merged_into uuid references rigo.customers(id) on delete set null;
alter table rigo.customers add column if not exists billing_contact jsonb not null default '{}'::jsonb;
alter table rigo.locations add column if not exists site_contact_phone text not null default '';
-- Who pays for the job, when not the customer at the service location (a realtor paying for an inspection).
alter table rigo.jobs add column if not exists bill_to_customer_id uuid references rigo.customers(id);

-- Lower case without accents ("José Núñez" → "jose nunez") for search and duplicate checks.
create or replace function rigo.fold(t text) returns text language sql immutable as $$
  select translate(lower(coalesce(t, '')),
    'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿšžłđ',
    'aaaaaaaeeeeeiiiiiooooooouuuuuncyyszld')
$$;
-- Only the digits of a phone number ("(555) 201-0003" → "5552010003").
create or replace function rigo.digits(t text) returns text language sql immutable as $$
  select regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g')
$$;

-- Each merge, with exactly which records moved, so it can be undone within 30 days (D14).
create table if not exists rigo.customer_merges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  survivor_id uuid not null references rigo.customers(id) on delete cascade,
  merged_id uuid not null references rigo.customers(id) on delete cascade,
  moved jsonb not null,
  filled jsonb not null default '{}'::jsonb,
  merged_by uuid references rigo.users(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references rigo.users(id) on delete set null
);
create index if not exists customer_merges_idx on rigo.customer_merges (company_id, created_at desc);
