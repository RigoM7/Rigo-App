-- Launch of the rebuild (2026-10-08): the owner chose a fresh start, so the old live data (accounts,
-- workspaces and everything in them) is removed once, here. Tables stay; only rows go. On a new or
-- test database this finds nothing to remove.
do $$
declare t text;
begin
  select string_agg(format('rigo.%I', tablename), ', ') into t
    from pg_tables where schemaname = 'rigo' and tablename <> 'schema_migrations';
  if t is not null then execute 'truncate ' || t || ' cascade'; end if;
end $$;
