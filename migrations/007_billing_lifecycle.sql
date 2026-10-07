-- Billing lifecycle (Phase 1, WP2): re-billing after a void, due dates and balances, snapshots at
-- issue and at booking, payments with dates and states, customer credit, refunds and credit notes,
-- deposits, statements, reminders, invoice view links and invoice settings.
-- Additive only: the version still in production keeps reading and writing the same rows.

-- Invoices --------------------------------------------------------------------------------------
alter table rigo.invoices add column if not exists kind text not null default 'job';         -- job | rental | manual
alter table rigo.invoices add column if not exists replaces_invoice_id uuid references rigo.invoices(id);
alter table rigo.invoices add column if not exists location_id uuid references rigo.locations(id);
alter table rigo.invoices add column if not exists due_date date;
alter table rigo.invoices add column if not exists bill_to jsonb;                           -- names and addresses as issued
alter table rigo.invoices add column if not exists period_start date;
alter table rigo.invoices add column if not exists period_end date;
alter table rigo.invoices add column if not exists credited_minor bigint not null default 0; -- credit notes and customer credit applied
alter table rigo.invoices add column if not exists free_confirmed boolean not null default false;
alter table rigo.invoices add column if not exists voided_at timestamptz;
alter table rigo.invoices add column if not exists void_reason text;
alter table rigo.invoices add column if not exists submitted_by uuid references rigo.users(id);

update rigo.invoices set kind = 'rental' where recurring_plan_id is not null and kind = 'job';
update rigo.invoices i set due_date = ((i.issued_at at time zone c.timezone)::date + i.due_days)
  from rigo.companies c where c.id = i.company_id and i.issued_at is not null and i.due_date is null;
-- Rental periods were only written into the line description ("Rental 2026-01-01 to 2026-01-28").
update rigo.invoices i set period_start = substring(l.description from '(\d{4}-\d{2}-\d{2}) to \d{4}-\d{2}-\d{2}')::date,
                           period_end = substring(l.description from '\d{4}-\d{2}-\d{2} to (\d{4}-\d{2}-\d{2})')::date
  from rigo.invoice_lines l
 where l.invoice_id = i.id and l.position = 0 and i.recurring_plan_id is not null and i.period_start is null
   and l.description ~ '\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}';
create index if not exists invoices_job_idx on rigo.invoices (job_id);
create index if not exists invoices_customer_idx on rigo.invoices (company_id, customer_id);

-- A percent discount line (10% = 1000); fixed discounts keep using the rate.
alter table rigo.invoice_lines add column if not exists percent_bp integer;

-- Payments: a date, a reference, who collected it, and whether the office confirmed it ----------
alter table rigo.payments alter column invoice_id drop not null;
alter table rigo.payments add column if not exists customer_id uuid references rigo.customers(id);
alter table rigo.payments add column if not exists job_id uuid references rigo.jobs(id);
alter table rigo.payments add column if not exists kind text not null default 'payment';    -- payment | refund | deposit
alter table rigo.payments add column if not exists paid_on date;
alter table rigo.payments add column if not exists reference text not null default '';
alter table rigo.payments add column if not exists photo_file_id uuid;
alter table rigo.payments add column if not exists state text not null default 'confirmed';  -- unconfirmed | confirmed | rejected
alter table rigo.payments add column if not exists applied_minor bigint;                    -- part applied to the invoice; the rest became credit
alter table rigo.payments add column if not exists applied_at timestamptz;                   -- when it was applied (rows from before this have neither)
alter table rigo.payments add column if not exists confirmed_by uuid references rigo.users(id);
alter table rigo.payments add column if not exists confirmed_at timestamptz;
alter table rigo.payments add column if not exists rejected_reason text;
alter table rigo.payments add column if not exists rejected_by uuid references rigo.users(id);
alter table rigo.payments add column if not exists rejected_at timestamptz;
update rigo.payments p set customer_id = i.customer_id, applied_minor = p.amount_minor, applied_at = p.recorded_at,
       paid_on = (p.recorded_at at time zone c.timezone)::date
  from rigo.invoices i join rigo.companies c on c.id = i.company_id
 where i.id = p.invoice_id and p.paid_on is null;
create index if not exists payments_invoice_idx on rigo.payments (invoice_id);
create index if not exists payments_job_idx on rigo.payments (job_id);

-- Customer credit: overpayments, deposits and credit applied to invoices (a signed ledger) -------
create table if not exists rigo.credit_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  customer_id uuid not null references rigo.customers(id) on delete cascade,
  amount_minor bigint not null,                     -- + adds credit, - uses it
  kind text not null check (kind in ('overpayment','deposit','applied','refund','reversal')),
  payment_id uuid references rigo.payments(id),
  invoice_id uuid references rigo.invoices(id),
  note text not null default '',
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now()
);
create index if not exists credit_entries_customer_idx on rigo.credit_entries (company_id, customer_id);

-- Amounts taken off an issued invoice's balance: credit notes and customer credit applied.
create table if not exists rigo.invoice_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  invoice_id uuid not null references rigo.invoices(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  source text not null check (source in ('credit_note','customer_credit')),
  note text not null default '',
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now()
);
create index if not exists invoice_credits_invoice_idx on rigo.invoice_credits (invoice_id);

-- Customers: payment terms and monthly statements -------------------------------------------------
alter table rigo.customers add column if not exists payment_terms_days integer;
alter table rigo.customers add column if not exists monthly_statement boolean not null default false;

-- Jobs keep the address they were booked for; editing a location changes future jobs only -------
alter table rigo.jobs add column if not exists location_snapshot jsonb;
update rigo.jobs j set location_snapshot = jsonb_build_object('label', l.label, 'address', l.address, 'access', l.access_instructions, 'siteContact', l.site_contact)
  from rigo.locations l where l.id = j.location_id and j.location_snapshot is null;
-- Set by the database whenever a job is created or moved to another location, whatever code writes it.
create or replace function rigo.job_location_snapshot() returns trigger language plpgsql as $$
begin
  if new.location_id is null then
    new.location_snapshot := null;
  elsif tg_op = 'INSERT' or new.location_id is distinct from old.location_id or new.location_snapshot is null then
    select jsonb_build_object('label', l.label, 'address', l.address, 'access', l.access_instructions, 'siteContact', l.site_contact)
      into new.location_snapshot from rigo.locations l where l.id = new.location_id;
  end if;
  return new;
end $$;
drop trigger if exists job_location_snapshot on rigo.jobs;
create trigger job_location_snapshot before insert or update of location_id, location_snapshot on rigo.jobs
  for each row execute function rigo.job_location_snapshot();

-- Services: print the driver's completion notes on the invoice (opt-in) ----------------------------
alter table rigo.services add column if not exists invoice_shows_notes boolean not null default false;

-- Statements: a customer's open invoices and payments as of a date ------------------------------
create table if not exists rigo.statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  customer_id uuid not null references rigo.customers(id) on delete cascade,
  statement_date date not null,
  data jsonb not null,
  balance_minor bigint not null,
  message_id uuid references rigo.messages(id),
  created_by uuid references rigo.users(id),
  created_at timestamptz not null default now(),
  unique (company_id, customer_id, statement_date)
);

-- Secure, expiring links to view an issued invoice without signing in ---------------------------
create table if not exists rigo.invoice_links (
  token_hash text primary key,
  company_id uuid not null references rigo.companies(id) on delete cascade,
  invoice_id uuid not null references rigo.invoices(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invoice_links_invoice_idx on rigo.invoice_links (invoice_id);

-- Manual invoices have no service, so they carry their own tax rate (also an office override).
alter table rigo.invoices add column if not exists tax_rate_bp integer;

-- A collection reminder the office decided not to send is kept as "skipped" (never re-prepared).
alter table rigo.messages drop constraint if exists messages_status_check;
alter table rigo.messages add constraint messages_status_check
  check (status in ('prepared','simulated','queued','sent','delivered','failed','replied','skipped'));
alter table rigo.messages add column if not exists statement_id uuid references rigo.statements(id);
