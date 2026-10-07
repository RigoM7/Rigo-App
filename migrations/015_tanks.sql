-- WP9: a customer's tanks at a location (what each holds, its size, how to fill it), chosen per
-- delivery line on fuel stops (R7-M4). Delivery lines themselves live in the job's completion record.
alter table rigo.locations add column if not exists tanks jsonb not null default '[]'::jsonb;
