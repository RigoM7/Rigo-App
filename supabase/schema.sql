-- Run once in the SQL editor of the Supabase project used by Rigo.
create table if not exists public.rigo_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id),
  state jsonb not null,
  version integer not null default 1 check (version > 0),
  audit jsonb not null default '[]'::jsonb,
  receipts jsonb not null default '{}'::jsonb
);
alter table public.rigo_workspaces enable row level security;
-- All access goes through the Vercel API, which validates the Supabase user
-- and enforces workspace membership and business rules. No public policies.
revoke all on public.rigo_workspaces from anon, authenticated;
grant all on public.rigo_workspaces to service_role;
