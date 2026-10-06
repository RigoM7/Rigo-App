-- Round 1 account fixes: owner-created password reset links, email confirmation and email change,
-- account deletion by anonymization, and faster sign-in failure lookups.

-- Owner-created reset links record who issued them and for which company.
alter table rigo.password_resets
  add column issued_by uuid references rigo.users(id) on delete set null,
  add column company_id uuid references rigo.companies(id) on delete cascade;
create index password_resets_user_idx on rigo.password_resets (user_id);

alter table rigo.users
  add column email_verified_at timestamptz,
  add column deleted_at timestamptz;

-- Single-use links sent by email: confirming an address ("verify") or switching to a new one ("change").
create table rigo.email_tokens (
  token_hash text primary key,
  user_id uuid not null references rigo.users(id) on delete cascade,
  purpose text not null check (purpose in ('verify','change')),
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_tokens_user_idx on rigo.email_tokens (user_id, purpose);

create index auth_attempts_at_idx on rigo.auth_attempts (at);
