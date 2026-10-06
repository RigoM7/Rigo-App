-- Rentals and recurring plans (Phase 1, WP4): visits arrive assigned, credits from pauses and early
-- ends carry to the next rent invoice, and rental units (PT-101...) are tracked as on site, in the
-- yard or missing. Additive only.

alter table rigo.recurring_plans add column if not exists default_user_id uuid references rigo.users(id);
alter table rigo.recurring_plans add column if not exists default_resource_ids uuid[] not null default '{}';
-- Credits owed from issued periods (a pause after the invoice went out), taken off the next rent invoice.
alter table rigo.recurring_plans add column if not exists pending_credits jsonb not null default '[]'::jsonb;
alter table rigo.recurring_plans add column if not exists deposit_received_minor bigint not null default 0;
alter table rigo.recurring_plans add column if not exists rates_requested_at timestamptz;

-- Rental units: where each one is.
alter table rigo.resources add column if not exists placement text not null default 'yard';
alter table rigo.resources add column if not exists plan_id uuid references rigo.recurring_plans(id) on delete set null;
alter table rigo.resources add column if not exists placed_at timestamptz;
alter table rigo.resources drop constraint if exists resources_placement_check;
alter table rigo.resources add constraint resources_placement_check check (placement in ('yard','on_site','missing'));
