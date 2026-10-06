-- Milestone G groundwork: usage of paid services per company per month. Billing stays off; this
-- only counts, and enforces a monthly cap when the platform sets one. Additive.
create table if not exists public.rigo_usage (
  workspace_id uuid not null references public.rigo_workspaces(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  kind text not null check (kind in ('geocoding')),
  count int not null default 0,
  primary key (workspace_id, month, kind)
);
alter table public.rigo_usage enable row level security;
revoke all on public.rigo_usage from anon, authenticated;
grant all on public.rigo_usage to service_role;

-- Counts one use and returns the month's total; refuses once a set limit is reached.
create or replace function public.rigo_count_usage(p_workspace uuid, p_kind text, p_limit int)
returns int language plpgsql set search_path = '' as $$
declare v_month text := to_char(now() at time zone 'utc', 'YYYY-MM'); v_count int;
begin
  insert into public.rigo_usage (workspace_id, month, kind, count) values (p_workspace, v_month, p_kind, 1)
    on conflict (workspace_id, month, kind) do update set count = public.rigo_usage.count + 1
    where p_limit is null or public.rigo_usage.count < p_limit
    returning count into v_count;
  if v_count is null then raise exception 'rigo:usage_limit'; end if;
  return v_count;
end $$;
revoke all on function public.rigo_count_usage(uuid, text, int) from public, anon, authenticated;
grant execute on function public.rigo_count_usage(uuid, text, int) to service_role;
