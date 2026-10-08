-- Rebuild, step 6: invoices and payments for any business. Money is exact, in minor units (cents);
-- rates are ten-thousandths. Totals are null while an invoice is held: a missing price is never zero.

create table rigo.money_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  number text,                                   -- given when issued
  client_id uuid references rigo.clients(id),
  status text not null default 'draft' check (status in ('held','draft','approved','issued','void')),
  hold_reasons text[] not null default '{}',
  currency text not null default 'USD',
  tax_rate_bp integer,
  tax_exempt boolean not null default false,
  subtotal_minor bigint,
  tax_minor bigint,
  total_minor bigint,
  paid_minor bigint not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  terms_days integer not null default 30,
  issued_on date,
  due_on date,
  notes text not null default '',
  prepared_by text not null default 'person' check (prepared_by in ('person','rigo')),
  approved_by uuid references rigo.users(id) on delete set null,
  approved_at timestamptz,
  issued_by uuid references rigo.users(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  version integer not null default 1,
  created_by uuid references rigo.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index money_invoices_company_idx on rigo.money_invoices (company_id, status, created_at desc);
create index money_invoices_client_idx on rigo.money_invoices (company_id, client_id);
create unique index money_invoices_number_key on rigo.money_invoices (company_id, number) where number is not null;

create table rigo.money_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  invoice_id uuid not null references rigo.money_invoices(id) on delete cascade,
  work_id uuid references rigo.work_items(id) on delete set null,
  catalog_id uuid references rigo.catalog_items(id) on delete set null,
  description text not null,
  quantity text not null default '1',
  unit text not null default '',
  rate_e4 bigint,
  amount_minor bigint,
  taxable boolean not null default false,
  position integer not null default 0
);
create index money_invoice_lines_invoice_idx on rigo.money_invoice_lines (invoice_id, position);

-- Which work an invoice bills. A piece of work is on at most one invoice that isn't void.
create table rigo.money_invoice_work (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  invoice_id uuid not null references rigo.money_invoices(id) on delete cascade,
  work_id uuid not null references rigo.work_items(id) on delete cascade,
  primary key (work_id)
);

create table rigo.money_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  invoice_id uuid not null references rigo.money_invoices(id) on delete cascade,
  client_id uuid references rigo.clients(id),
  amount_minor bigint not null check (amount_minor > 0),
  method text not null check (method in ('cash','check','card','bank_transfer','other')),
  reference text not null default '',
  received_on date not null,
  recorded_by uuid references rigo.users(id) on delete set null,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
create index money_payments_invoice_idx on rigo.money_payments (company_id, invoice_id);

-- Invoice settings: numbering continues from a previous system; payment terms in days.
alter table rigo.companies add column if not exists invoice_prefix text not null default 'INV-';
alter table rigo.companies add column if not exists terms_days integer not null default 30;
alter table rigo.companies add column if not exists invoice_approval boolean not null default true;
