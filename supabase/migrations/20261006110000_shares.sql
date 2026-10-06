-- Milestone F: explicit sharing between two companies. Companies stay independent by default;
-- a share names the lists it covers (never invoices or payments), needs an owner of the source
-- to propose it (with authority in the target too) and an owner of the target to accept it, and
-- either side can revoke it at any time. Additive.
create table if not exists public.rigo_shares (
  id uuid primary key default gen_random_uuid(),
  from_workspace uuid not null references public.rigo_workspaces(id) on delete cascade,
  to_workspace uuid not null references public.rigo_workspaces(id) on delete cascade,
  lists text[] not null check (lists <@ array['clients', 'locations', 'services', 'employees', 'vehicles', 'equipment'] and cardinality(lists) between 1 and 6),
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'revoked')),
  proposed_by uuid not null references auth.users(id),
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_workspace <> to_workspace)
);
create unique index if not exists rigo_shares_one_open on public.rigo_shares (from_workspace, to_workspace) where status in ('pending', 'active');
create index if not exists rigo_shares_to on public.rigo_shares (to_workspace) where status in ('pending', 'active');
alter table public.rigo_shares enable row level security;
revoke all on public.rigo_shares from anon, authenticated;
grant all on public.rigo_shares to service_role;

create or replace function public.rigo_share_propose(p_actor uuid, p_from uuid, p_to uuid, p_lists text[])
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.rigo_memberships where workspace_id = p_from and user_id = p_actor and status = 'active' and role = 'Owner') then
    raise exception 'rigo:not_allowed';
  end if;
  -- Authority on both companies: the proposer must also run the receiving company.
  if not exists (select 1 from public.rigo_memberships where workspace_id = p_to and user_id = p_actor and status = 'active' and role in ('Owner', 'Administrator')) then
    raise exception 'rigo:not_allowed';
  end if;
  if exists (select 1 from public.rigo_shares where from_workspace = p_from and to_workspace = p_to and status in ('pending', 'active')) then
    raise exception 'rigo:already_shared';
  end if;
  insert into public.rigo_shares (from_workspace, to_workspace, lists, proposed_by) values (p_from, p_to, p_lists, p_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.rigo_share_decide(p_actor uuid, p_share uuid, p_decision text)
returns text language plpgsql set search_path = '' as $$
declare v public.rigo_shares;
begin
  select * into v from public.rigo_shares where id = p_share for update;
  if not found then raise exception 'rigo:not_found'; end if;
  if p_decision in ('accept', 'decline') then
    if v.status <> 'pending' then return v.status; end if;
    if not exists (select 1 from public.rigo_memberships where workspace_id = v.to_workspace and user_id = p_actor and status = 'active' and role = 'Owner') then
      raise exception 'rigo:not_allowed';
    end if;
    update public.rigo_shares set status = case when p_decision = 'accept' then 'active' else 'declined' end, decided_by = p_actor, decided_at = now() where id = v.id;
    return case when p_decision = 'accept' then 'active' else 'declined' end;
  elsif p_decision = 'revoke' then
    if v.status not in ('pending', 'active') then return v.status; end if;
    if not exists (select 1 from public.rigo_memberships where workspace_id in (v.from_workspace, v.to_workspace) and user_id = p_actor and status = 'active' and role = 'Owner') then
      raise exception 'rigo:not_allowed';
    end if;
    update public.rigo_shares set status = 'revoked', decided_by = p_actor, decided_at = now() where id = v.id;
    return 'revoked';
  end if;
  raise exception 'rigo:not_allowed';
end $$;
revoke all on function public.rigo_share_propose(uuid, uuid, uuid, text[]), public.rigo_share_decide(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rigo_share_propose(uuid, uuid, uuid, text[]), public.rigo_share_decide(uuid, uuid, text) to service_role;
