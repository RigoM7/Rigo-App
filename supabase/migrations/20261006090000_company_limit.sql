-- Limits for free company creation: at most 10 new companies per account per day.
-- Replaces one function; no table or row changes.
create or replace function public.rigo_create_company(p_user uuid, p_email text, p_request text, p_name text, p_state jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'rigo:name_required'; end if;
  if coalesce(p_request, '') = '' or length(p_request) > 100 then raise exception 'rigo:request_required'; end if;
  -- One creation at a time per account keeps both the retry check and the daily limit exact.
  perform pg_advisory_xact_lock(hashtextextended('rigo-create:' || p_user::text, 0));
  select workspace_id into v_id from public.rigo_company_requests where user_id = p_user and request_id = p_request;
  if found then return v_id; end if;
  -- Free company creation is limited per account per day (retries above are unaffected).
  if (select count(*) from public.rigo_company_requests where user_id = p_user and created_at > now() - interval '1 day') >= 10 then
    raise exception 'rigo:too_many_companies';
  end if;
  v_id := gen_random_uuid();
  insert into public.rigo_workspaces (id, owner_id, state, version, audit, receipts)
    values (v_id, p_user, jsonb_set(jsonb_set(p_state, '{id}', to_jsonb(v_id::text)), '{name}', to_jsonb(trim(p_name))), 1, '[]', '{}');
  insert into public.rigo_memberships (workspace_id, user_id, email, role, granted_by)
    values (v_id, p_user, lower(p_email), 'Owner', p_user);
  insert into public.rigo_company_requests (user_id, request_id, workspace_id) values (p_user, p_request, v_id);
  return v_id;
end $$;
