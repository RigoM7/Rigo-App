-- Milestone E: private and selected-people templates. Structure only, versioned; a company that
-- used a template is never changed when the template gets a new version. Additive.
create table if not exists public.rigo_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  visibility text not null default 'private' check (visibility in ('private', 'selected')),
  shared_with text[] not null default '{}',
  latest_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rigo_templates_owner on public.rigo_templates (owner_id);
create index if not exists rigo_templates_shared on public.rigo_templates using gin (shared_with);
create table if not exists public.rigo_template_versions (
  template_id uuid not null references public.rigo_templates(id) on delete cascade,
  version int not null,
  content jsonb not null,
  source_workspace uuid,
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);
alter table public.rigo_templates enable row level security;
alter table public.rigo_template_versions enable row level security;
revoke all on public.rigo_templates, public.rigo_template_versions from anon, authenticated;
grant all on public.rigo_templates, public.rigo_template_versions to service_role;

-- Publish a new template, or a new version of one the user owns. Versions never change later.
create or replace function public.rigo_publish_template(p_user uuid, p_template uuid, p_name text, p_description text, p_content jsonb, p_source uuid)
returns json language plpgsql set search_path = '' as $$
declare v_id uuid; v_version int;
begin
  if p_template is null then
    insert into public.rigo_templates (owner_id, name, description) values (p_user, trim(p_name), coalesce(p_description, ''))
      returning id, latest_version into v_id, v_version;
  else
    select id into v_id from public.rigo_templates where id = p_template and owner_id = p_user for update;
    if not found then raise exception 'rigo:not_allowed'; end if;
    update public.rigo_templates set latest_version = latest_version + 1, name = trim(p_name), description = coalesce(p_description, ''), updated_at = now()
      where id = v_id returning latest_version into v_version;
  end if;
  insert into public.rigo_template_versions (template_id, version, content, source_workspace) values (v_id, v_version, p_content, p_source);
  return json_build_object('id', v_id, 'version', v_version);
end $$;
revoke all on function public.rigo_publish_template(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.rigo_publish_template(uuid, uuid, text, text, jsonb, uuid) to service_role;
