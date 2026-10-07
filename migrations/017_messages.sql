-- WP13: the assistant's answers carry links to the records they talk about, and a driver's
-- "On my way" (with an optional arrival estimate) is kept on the job.
alter table rigo.assistant_messages add column if not exists links jsonb not null default '[]'::jsonb;
alter table rigo.jobs add column if not exists en_route_at timestamptz;
alter table rigo.jobs add column if not exists en_route_eta_minutes integer;
