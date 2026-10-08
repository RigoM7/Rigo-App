-- Rebuild, step 1: the any-business workspace model. Only adds. Companies, roles, memberships and
-- invitations stay as they are (accounts and isolation are kept); the old field-service tables are
-- left unused until a cleanup the owner approves at launch.

-- The workspace's own words (work, customer, person, equipment, location), the template it started
-- from and the sentence its owner used to describe it.
alter table rigo.companies add column if not exists vocabulary jsonb not null default '{}'::jsonb;
alter table rigo.companies add column if not exists template_key text;
alter table rigo.companies add column if not exists description text not null default '';

-- Roles are built by the owner: which app a role opens (office places or the worker's phone
-- screens) and its place in lists. The Owner role (is_owner) always exists.
alter table rigo.roles add column if not exists app text not null default 'office' check (app in ('office','worker'));
alter table rigo.roles add column if not exists position integer not null default 0;
alter table rigo.roles add column if not exists created_at timestamptz not null default now();

-- Record types: the kinds of records a workspace keeps and the custom fields each carries.
create table rigo.record_types (
  company_id uuid not null references rigo.companies(id) on delete cascade,
  kind text not null check (kind in ('work','customer','equipment')),
  enabled boolean not null default true,
  fields jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);

-- Stages of the main work record, built by the owner and each tagged with a meaning.
create table rigo.stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references rigo.companies(id) on delete cascade,
  key text not null,
  name text not null,
  meaning text not null check (meaning in ('open','active','finished','cancelled','failed')),
  position integer not null default 0,
  requires text[] not null default '{}',
  next_keys text[],                        -- null: work may move to any stage
  created_at timestamptz not null default now(),
  unique (company_id, key)
);
create index stages_company_idx on rigo.stages (company_id, position);
