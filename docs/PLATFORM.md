# Rigo platform: implementation record

This document tracks the move from a single-company app to a customizable
business platform, one milestone at a time. It records what exists, what was
chosen, how it was verified, and what comes next. Environment variables are
listed by name only.

## 1. Inventory (before Milestone A, 2026-10-05)

| Area | State | Notes |
| --- | --- | --- |
| Jobs, dispatch, workflow builder, data library, imports/undo, invoices, payments records, team roles, setup checklist, templates, demo data | Working | Bundled React app (`index.html`), rules in `lib/domain.cjs` |
| Sign-in, password reset, invitation email, self sign-up with owner approval | Working | `rigo-access.js` + `lib/server.cjs`, Supabase Auth |
| Shared storage with server role checks | Working | One JSON document per company in `rigo_workspaces.state` |
| Field employee scoping (own jobs only) | Working | `visibleState` on the server |
| Address lookup (Mapbox) | Working when `MAPBOX_TOKEN` is set | Paid provider |
| Invitation inbox delivery | Unverified | Depends on the project's SMTP; acceptance by Supabase is not inbox receipt |
| Several companies per account | Missing | One company per owner (`owner_id` unique), owner fixed by `RIGO_OWNER_USER_ID` |
| Company creation, picker, switcher | Missing | App opened the first company returned |
| Multiple owners, administrator authority | Missing | Only the configured owner could invite |
| Isolated demo company | Missing | Demo data is loaded into the real company |
| AI, messaging, routing, online payments, recurring billing | Not configured | Out of scope for Milestones A and B |

## 2. Selected milestone: A — accounts and company foundation

Milestone A was incomplete (single fixed owner, one company per owner, no
creation or switching), so it was selected. Milestone B (isolated demo) has not
started.

### What changed

- **Accounts and companies.** Any verified account can create companies and
  belong to several. Access is one row per person per company in
  `rigo_memberships` (role, status, who granted it). Roles: Owner,
  Administrator, Dispatcher, Field employee, Viewer.
- **Server authorization.** Every request names its company explicitly
  (`id` / `workspace`). The server loads the caller's membership for that
  company on every request. An unknown company and one you are not in return
  the same 403. There is no default or "current" company on the server, and a
  write without a company id is rejected.
- **Invitations** (`rigo_invitations`): pending → accepted / declined /
  revoked / expired. Acceptance requires the invited, verified email, a
  pending and unexpired invitation, and that the inviter still has authority
  for that role. Repeat acceptance is harmless. Each company is separate: the
  same person can hold different roles in different companies.
- **Creation** (`rigo_create_company`): creates the company and its owner
  membership in one transaction. A request id per attempt makes retries return
  the same company. Similar names are allowed; companies are identified by id.
  New companies start empty: no records, members, credentials or demo data,
  and paid services off (`integrations.geocoding: false`).
- **Client.** After sign-in: pending invitations first; no companies →
  onboarding (create a company; demo shown as "coming soon"); one company →
  open it; several → remembered choice, else a picker. `?company=<id>` deep
  links are checked against memberships with a neutral message. The account
  menu has **Switch company** (switch, create, leave with confirmation, warns
  about unsynchronized field updates and open forms). Each browser tab stays
  bound to the company it opened; switching reloads the page.
- **Offline field updates** are stored per user and per company
  (`rigo-pending-<email>:<companyId>`). The old per-user queue moves to the
  company last opened in that browser.
- **People & access.** Owners and administrators manage access within their
  authority; owners see an **Owner** role option. Removal asks for
  confirmation. Pending invitations can be resent or cancelled.
- **Access requests** (self sign-up) are tied to the company in the sign-up
  link (`/?signup=1&join=<companyId>`); the link survives email confirmation.
- **Phones.** The account menu was hidden under 800px; it is now a 44px button
  so switching and signing out work on phones.

### Decisions

- **Authority.** Owners manage any role. Administrators manage Dispatcher,
  Field employee and Viewer only; they never grant or remove Owner or
  Administrator. Administrator is not ownership.
- **Last owner.** Membership changes lock the company row, so concurrent
  removals or demotions can never leave a company without an owner.
- **Leaving.** Anyone may leave a company, except its last owner.
- **Resend.** Sending again replaces the earlier pending invitation, which
  can no longer be accepted. Sends are limited to one per email per minute.
- **Inviter loses authority.** An invitation from someone who was removed or
  demoted is withdrawn and cannot be accepted.
- **Removed members** return only through a new invitation; an old accepted
  invitation cannot restore access.
- **Role change** of an existing member happens by inviting the same email with
  a different role (explicit, audited).
- **Email failure** never grants access: the invitation is withdrawn and the
  sender sees an error.
- **Address lookup** is grandfathered for companies that existed before
  Milestone A and off for new companies. There is no in-app switch yet.
- **`state.members`** stays as a display mirror refreshed from the tables. It
  is never used for authorization.

### Data model and migration

`supabase/migrations/20261005120000_companies.sql` (additive):

- drops the one-company-per-owner constraint; `owner_id` now means "created by";
- adds `created_at` to `rigo_workspaces`;
- adds `rigo_memberships`, `rigo_invitations`, `rigo_company_requests`
  (RLS on, no client grants, service role only);
- adds the rule functions `rigo_can_manage`, `rigo_create_company`,
  `rigo_invite`, `rigo_answer_invitation`, `rigo_revoke_invitation`,
  `rigo_add_member`, `rigo_change_member` (fixed `search_path`);
- backfills from evidence only: the company's `owner_id` becomes Owner; JSON
  members recorded as active whose user id belongs to the same email keep
  their role; sent invitations become pending for 14 days. Nobody else is
  promoted and the company JSON is not modified.

### Deployment order

1. Apply the migration (done 2026-10-05 on project `rigo-app`). The deployed
   code ignores the new tables, so this is safe before the code ships.
2. Merge the code. `RIGO_OWNER_USER_ID` can then be removed from Vercel.

Production result of step 1: company `370 Enviro LLC` unchanged (state and
audit checksums and version 60 identical before and after); memberships:
1 Owner (`owner_id`), 2 Administrators (both active, verified accounts). A
fourth account with no membership evidence received nothing.

### Recovery

- Code: revert the merge commit; the old code ignores the new tables.
- Database: the new tables and functions can be dropped. Re-add
  `rigo_workspaces_owner_id_key` only if `owner_id` is still unique (no
  companies were created after the migration); otherwise keep it dropped.
- No existing row was changed, so there is nothing to restore.

## 3. Verification

| Check | Result |
| --- | --- |
| `tests/companies-db.test.cjs` — migration on a copy of the live shape, creation, invitations, authority, concurrent last-owner race (real PostgreSQL 16) | 8/8 pass |
| `tests/companies-server.test.cjs` — real server code against the real migration: isolation, cross-company denial, team linking, access requests, paid services, live company intact | 13/13 pass |
| `tests/invitations.test.cjs` — invitation, roles, retries, cooldown, viewer/field rules, access requests | 13/13 pass |
| Full `npm test` | 58/58 pass |
| `tests/companies.browser.cjs` — onboarding, create + retry, invitations, picker, keyboard, deep link, switcher, per-tab binding, offline queue move, leave, 360px | pass |
| `tests/browser.cjs`, `tests/group1.browser.cjs`, `tests/groups234.browser.cjs` | pass |
| Production after migration: memberships, checksums, grants, advisors | verified |

Tests use a local database and a simulated Supabase/Mapbox; they refuse any
other host, so they never touch production data, credentials, live providers
or real recipients. Screenshots: `docs/screenshots/rigo-a-*.png`.

### Not verified

- Real inbox delivery of invitation emails (depends on SMTP).
- The new flows against the live Supabase API end to end; the SQL ran in
  production, and the API calls were exercised against a local copy of the
  same schema.
- Supabase advisor: **leaked password protection** is off (Auth setting, not
  changed). Turning it on is recommended.

## 4. Progress

- [x] Milestone A — accounts and company foundation
- [ ] Milestone B — isolated demo company (next)
- [ ] Later — per-company integrations settings (address lookup switch),
      AI, messaging, routing, payments, billing

## 5. Next milestone: B — isolated demo

A separate demo company per account, created on request from the onboarding
screen, clearly labelled, with fictional records, no real recipients and all
paid services off; removable in one step without touching real companies.
