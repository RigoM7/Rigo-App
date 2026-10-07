-- WP6: dispatch. A truck out of service can say until when; a job keeps the changes its driver
-- hasn't seen yet, so the phone can show "Changed" until the driver acknowledges it.
alter table rigo.resources add column if not exists out_of_service_until date;
alter table rigo.jobs add column if not exists driver_changes jsonb;
create index if not exists resources_name_idx on rigo.resources (company_id, lower(name));
-- Which kinds of work a truck or unit is for (fuel, septic, portable toilets); empty means any.
alter table rigo.resources add column if not exists categories text[] not null default '{}';
