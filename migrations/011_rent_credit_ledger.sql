-- Phase 1 review: rental credits are tracked by the day, so a pause, a resume and an early end can
-- never credit the same day twice, and a resume bills again from the day service restarts.

-- Days of each issued rent invoice already credited: { "<invoice id>": ["2026-10-10", ...] }.
alter table rigo.recurring_plans add column if not exists credited_days jsonb not null default '{}'::jsonb;
-- Pauses that are over, kept so rebuilt and later rent invoices still leave those days out.
alter table rigo.recurring_plans add column if not exists pause_history jsonb not null default '[]'::jsonb;
-- A deposit payment names its plan, so rejecting it lowers what the plan shows as received.
alter table rigo.payments add column if not exists plan_id uuid references rigo.recurring_plans(id) on delete set null;
