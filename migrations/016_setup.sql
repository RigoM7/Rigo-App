-- WP11: setup and companies. A service can be priced on each invoice instead of from rates ("price
-- set per job"), which counts as priced for setup; owners can archive a company.
alter table rigo.services add column if not exists priced_per_job boolean not null default false;
alter table rigo.companies add column if not exists archived_at timestamptz;
