-- Critique Phase 1 (WP1): customer tax exemption (beats the service's tax rate) and
-- customer-specific prices by service and price line, in ten-thousandths of the currency.
alter table rigo.customers
  add column tax_exempt boolean not null default false,
  add column tax_exempt_note text not null default '',
  add column price_overrides jsonb not null default '{}'::jsonb;
