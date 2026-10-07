-- WP16: a person's language for the driver screens, sign-in and their notifications (null: same as
-- their device), and a customer's language for the messages Rigo prepares for them (D8).
alter table rigo.users add column if not exists language text check (language in ('en','es'));
alter table rigo.customers add column if not exists language text not null default 'en' check (language in ('en','es'));
