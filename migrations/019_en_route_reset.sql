-- "On my way" belongs to one driver heading to one time slot: it is cleared when the job is given
-- to someone else, moved, or reopened (review finding), so a new driver can say it again and the
-- customer hears about the right trip.
create or replace function rigo.jobs_reset_en_route() returns trigger language plpgsql as $$
begin
  if new.en_route_at is not null and old.en_route_at is not null and (
       new.assigned_user_id is distinct from old.assigned_user_id
    or new.scheduled_start is distinct from old.scheduled_start
    or (new.status = 'open' and old.status <> 'open')) then
    new.en_route_at := null;
    new.en_route_eta_minutes := null;
  end if;
  return new;
end $$;
drop trigger if exists jobs_reset_en_route on rigo.jobs;
create trigger jobs_reset_en_route before update on rigo.jobs for each row execute function rigo.jobs_reset_en_route();
