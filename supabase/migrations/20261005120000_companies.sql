-- Milestone A: personal accounts, several companies per account, multiple owners.
-- Additive: no existing row is changed or deleted. See docs/PLATFORM.md for order
-- of deployment and recovery.

-- An account may create or own several companies. owner_id stays as "created by".
alter table public.rigo_workspaces drop constraint if exists rigo_workspaces_owner_id_key;
alter table public.rigo_workspaces add column if not exists created_at timestamptz not null default now();

-- A person's access and role in one company. The server authorizes from this table.
create table if not exists public.rigo_memberships (
  workspace_id uuid not null references public.rigo_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  email text not null,
  role text not null check (role in ('Owner', 'Administrator', 'Dispatcher', 'Field employee', 'Viewer')),
  status text not null default 'active' check (status in ('active', 'removed')),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists rigo_memberships_user on public.rigo_memberships (user_id) where status = 'active';

-- A pending offer to join a company with a role. Acceptance matches the verified email.
create table if not exists public.rigo_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.rigo_workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('Owner', 'Administrator', 'Dispatcher', 'Field employee', 'Viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);
create unique index if not exists rigo_invitations_one_pending on public.rigo_invitations (workspace_id, lower(email)) where status = 'pending';
create index if not exists rigo_invitations_email on public.rigo_invitations (lower(email)) where status = 'pending';

-- Retry protection for company creation: one request id creates at most one company.
create table if not exists public.rigo_company_requests (
  user_id uuid not null references auth.users(id),
  request_id text not null,
  workspace_id uuid not null references public.rigo_workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

alter table public.rigo_memberships enable row level security;
alter table public.rigo_invitations enable row level security;
alter table public.rigo_company_requests enable row level security;
-- All access goes through the server API with the service role. No public policies.
revoke all on public.rigo_memberships, public.rigo_invitations, public.rigo_company_requests from anon, authenticated;
grant all on public.rigo_memberships, public.rigo_invitations, public.rigo_company_requests to service_role;

-- Who may grant, change or remove a role. Owners: any role. Administrators:
-- Dispatcher, Field employee and Viewer only. Administrators never grant ownership.
create or replace function public.rigo_can_manage(actor_role text, target_role text)
returns boolean language sql immutable set search_path = '' as $$
  select actor_role = 'Owner'
      or (actor_role = 'Administrator' and target_role in ('Dispatcher', 'Field employee', 'Viewer'))
$$;

-- Create a company and its first owner membership in one transaction.
-- The same (user, request id) always returns the same company.
create or replace function public.rigo_create_company(p_user uuid, p_email text, p_request text, p_name text, p_state jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'rigo:name_required'; end if;
  if coalesce(p_request, '') = '' or length(p_request) > 100 then raise exception 'rigo:request_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_request, 0));
  select workspace_id into v_id from public.rigo_company_requests where user_id = p_user and request_id = p_request;
  if found then return v_id; end if;
  v_id := gen_random_uuid();
  insert into public.rigo_workspaces (id, owner_id, state, version, audit, receipts)
    values (v_id, p_user, jsonb_set(jsonb_set(p_state, '{id}', to_jsonb(v_id::text)), '{name}', to_jsonb(trim(p_name))), 1, '[]', '{}');
  insert into public.rigo_memberships (workspace_id, user_id, email, role, granted_by)
    values (v_id, p_user, lower(p_email), 'Owner', p_user);
  insert into public.rigo_company_requests (user_id, request_id, workspace_id) values (p_user, p_request, v_id);
  return v_id;
end $$;

-- Invite an email to a company. Resending replaces the previous pending invitation,
-- which can no longer be accepted.
create or replace function public.rigo_invite(p_workspace uuid, p_actor uuid, p_email text, p_role text, p_days int)
returns uuid language plpgsql set search_path = '' as $$
declare v_role text; v_id uuid;
begin
  perform 1 from public.rigo_workspaces where id = p_workspace for update;
  if not found then raise exception 'rigo:not_found'; end if;
  select role into v_role from public.rigo_memberships where workspace_id = p_workspace and user_id = p_actor and status = 'active';
  if v_role is null then raise exception 'rigo:not_member'; end if;
  if not public.rigo_can_manage(v_role, p_role) then raise exception 'rigo:not_allowed'; end if;
  if exists (select 1 from public.rigo_memberships where workspace_id = p_workspace and lower(email) = lower(p_email) and status = 'active') then
    raise exception 'rigo:already_member';
  end if;
  update public.rigo_invitations set status = 'revoked', decided_at = now(), decided_by = p_actor
    where workspace_id = p_workspace and lower(email) = lower(p_email) and status = 'pending';
  insert into public.rigo_invitations (workspace_id, email, role, invited_by, expires_at)
    values (p_workspace, lower(p_email), p_role, p_actor, now() + make_interval(days => greatest(1, least(p_days, 30))))
    returning id into v_id;
  return v_id;
end $$;

-- Accept or decline an invitation. Validates state, expiry, recipient, the inviter's
-- current authority and any existing membership in one transaction.
create or replace function public.rigo_answer_invitation(p_invitation uuid, p_user uuid, p_email text, p_accept boolean)
returns text language plpgsql set search_path = '' as $$
declare inv public.rigo_invitations; v_inviter text; v_member public.rigo_memberships;
begin
  select * into inv from public.rigo_invitations where id = p_invitation for update;
  if not found or lower(inv.email) <> lower(p_email) then raise exception 'rigo:not_found'; end if;
  if inv.status <> 'pending' then return inv.status; end if;
  if inv.expires_at < now() then
    update public.rigo_invitations set status = 'expired', decided_at = now() where id = inv.id;
    return 'expired';
  end if;
  if not p_accept then
    update public.rigo_invitations set status = 'declined', decided_at = now(), decided_by = p_user where id = inv.id;
    return 'declined';
  end if;
  perform 1 from public.rigo_workspaces where id = inv.workspace_id for update;
  select role into v_inviter from public.rigo_memberships where workspace_id = inv.workspace_id and user_id = inv.invited_by and status = 'active';
  if v_inviter is null or not public.rigo_can_manage(v_inviter, inv.role) then
    update public.rigo_invitations set status = 'revoked', decided_at = now() where id = inv.id;
    return 'inviter_lacks_authority';
  end if;
  select * into v_member from public.rigo_memberships where workspace_id = inv.workspace_id and user_id = p_user;
  if found and v_member.status = 'active' then
    update public.rigo_invitations set status = 'accepted', decided_at = now(), decided_by = p_user where id = inv.id;
    return 'already_member';
  end if;
  insert into public.rigo_memberships (workspace_id, user_id, email, role, granted_by)
    values (inv.workspace_id, p_user, lower(p_email), inv.role, inv.invited_by)
    on conflict (workspace_id, user_id) do update
      set status = 'active', role = excluded.role, email = excluded.email, granted_by = excluded.granted_by, updated_at = now();
  update public.rigo_invitations set status = 'accepted', decided_at = now(), decided_by = p_user where id = inv.id;
  return 'accepted';
end $$;

-- Revoke a pending invitation.
create or replace function public.rigo_revoke_invitation(p_invitation uuid, p_actor uuid)
returns text language plpgsql set search_path = '' as $$
declare inv public.rigo_invitations; v_role text;
begin
  select * into inv from public.rigo_invitations where id = p_invitation for update;
  if not found then raise exception 'rigo:not_found'; end if;
  select role into v_role from public.rigo_memberships where workspace_id = inv.workspace_id and user_id = p_actor and status = 'active';
  if v_role is null or not public.rigo_can_manage(v_role, inv.role) then raise exception 'rigo:not_allowed'; end if;
  if inv.status <> 'pending' then return inv.status; end if;
  update public.rigo_invitations set status = 'revoked', decided_at = now(), decided_by = p_actor where id = inv.id;
  return 'revoked';
end $$;

-- Add a known, verified account directly (approved access request).
create or replace function public.rigo_add_member(p_workspace uuid, p_actor uuid, p_user uuid, p_email text, p_role text)
returns text language plpgsql set search_path = '' as $$
declare v_role text; v_member public.rigo_memberships;
begin
  perform 1 from public.rigo_workspaces where id = p_workspace for update;
  select role into v_role from public.rigo_memberships where workspace_id = p_workspace and user_id = p_actor and status = 'active';
  if v_role is null or not public.rigo_can_manage(v_role, p_role) then raise exception 'rigo:not_allowed'; end if;
  select * into v_member from public.rigo_memberships where workspace_id = p_workspace and user_id = p_user;
  if found and v_member.status = 'active' then return 'already_member'; end if;
  insert into public.rigo_memberships (workspace_id, user_id, email, role, granted_by)
    values (p_workspace, p_user, lower(p_email), p_role, p_actor)
    on conflict (workspace_id, user_id) do update
      set status = 'active', role = excluded.role, email = excluded.email, granted_by = excluded.granted_by, updated_at = now();
  return 'added';
end $$;

-- Change a member's role, or remove them (including leaving yourself).
-- The company row lock serializes membership changes, so two concurrent changes
-- can never remove the last owner.
create or replace function public.rigo_change_member(p_workspace uuid, p_actor uuid, p_target uuid, p_role text, p_remove boolean)
returns text language plpgsql set search_path = '' as $$
declare v_actor text; v_target public.rigo_memberships; v_owners int;
begin
  perform 1 from public.rigo_workspaces where id = p_workspace for update;
  if not found then raise exception 'rigo:not_found'; end if;
  select role into v_actor from public.rigo_memberships where workspace_id = p_workspace and user_id = p_actor and status = 'active';
  if v_actor is null then raise exception 'rigo:not_member'; end if;
  select * into v_target from public.rigo_memberships where workspace_id = p_workspace and user_id = p_target and status = 'active';
  if not found then raise exception 'rigo:target_not_member'; end if;
  if p_remove and p_actor = p_target then
    null; -- Anyone may leave a company, subject to the last-owner rule below.
  elsif not public.rigo_can_manage(v_actor, v_target.role) or (not p_remove and not public.rigo_can_manage(v_actor, p_role)) then
    raise exception 'rigo:not_allowed';
  end if;
  if v_target.role = 'Owner' and (p_remove or p_role <> 'Owner') then
    select count(*) into v_owners from public.rigo_memberships where workspace_id = p_workspace and role = 'Owner' and status = 'active';
    if v_owners <= 1 then raise exception 'rigo:last_owner'; end if;
  end if;
  if p_remove then
    update public.rigo_memberships set status = 'removed', updated_at = now(), granted_by = p_actor where workspace_id = p_workspace and user_id = p_target;
  else
    update public.rigo_memberships set role = p_role, updated_at = now(), granted_by = p_actor where workspace_id = p_workspace and user_id = p_target;
  end if;
  -- Invitations the target sent that they can no longer grant are withdrawn.
  update public.rigo_invitations set status = 'revoked', decided_at = now(), decided_by = p_actor
    where workspace_id = p_workspace and invited_by = p_target and status = 'pending'
      and (p_remove or not public.rigo_can_manage(p_role, role));
  return case when p_remove then 'removed' else 'changed' end;
end $$;

revoke all on function public.rigo_create_company(uuid, text, text, text, jsonb), public.rigo_invite(uuid, uuid, text, text, int),
  public.rigo_answer_invitation(uuid, uuid, text, boolean), public.rigo_revoke_invitation(uuid, uuid),
  public.rigo_add_member(uuid, uuid, uuid, text, text), public.rigo_change_member(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.rigo_create_company(uuid, text, text, text, jsonb), public.rigo_invite(uuid, uuid, text, text, int),
  public.rigo_answer_invitation(uuid, uuid, text, boolean), public.rigo_revoke_invitation(uuid, uuid),
  public.rigo_add_member(uuid, uuid, uuid, text, text), public.rigo_change_member(uuid, uuid, uuid, text, boolean)
  to service_role;

-- Backfill existing companies from authoritative evidence only:
-- 1. the workspace's owner_id is its owner;
-- 2. members recorded as active with a user id that belongs to the same email keep their role.
-- Nobody else is promoted, and the workspace JSON is not modified.
insert into public.rigo_memberships (workspace_id, user_id, email, role, granted_by, created_at)
select w.id, w.owner_id, lower(u.email), 'Owner', w.owner_id, w.created_at
from public.rigo_workspaces w join auth.users u on u.id = w.owner_id
on conflict (workspace_id, user_id) do nothing;

insert into public.rigo_memberships (workspace_id, user_id, email, role, granted_by)
select w.id, u.id, lower(u.email), m->>'role', w.owner_id
from public.rigo_workspaces w
cross join lateral jsonb_array_elements(coalesce(w.state->'members', '[]'::jsonb)) m
join auth.users u on u.id::text = m->'invitation'->>'userId' and lower(u.email) = lower(m->>'email')
where m->'invitation'->>'status' = 'active' and m->>'role' in ('Administrator', 'Dispatcher', 'Field employee', 'Viewer')
on conflict (workspace_id, user_id) do nothing;

-- Invitations that were sent but not yet used become pending invitations for 14 days.
insert into public.rigo_invitations (workspace_id, email, role, invited_by, expires_at)
select w.id, lower(m->>'email'), m->>'role', w.owner_id, now() + interval '14 days'
from public.rigo_workspaces w
cross join lateral jsonb_array_elements(coalesce(w.state->'members', '[]'::jsonb)) m
where m->'invitation'->>'status' = 'sent' and m->>'role' in ('Administrator', 'Dispatcher', 'Field employee', 'Viewer')
  and not exists (select 1 from public.rigo_memberships x join auth.users u on u.id = x.user_id where x.workspace_id = w.id and lower(u.email) = lower(m->>'email'))
on conflict do nothing;
