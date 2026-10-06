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

## 4. Milestone B — isolated free demo

### What changed

- **Explore the demo** from onboarding, the company picker or the switcher
  (`/?demo=1`). It is a fictional company, *Prairie Services Co. (demo)*,
  with fuel delivery, portable toilets and septic. It includes customers,
  locations, drivers, trucks, units, example rates, jobs in every stage,
  completion examples, and an unpaid and a paid invoice.
- **Built by the app's own rules.** `lib/demo-seed.js` is a versioned recipe
  of ordinary actions run through the same business rules as real companies.
  It is served as `/rigo-demo-seed.js`.
- **Local only.** The app runs on its built-in local adapter, namespaced per
  account (`rigo-demo:<userId>`). In the demo:
  - `window.Rigo.request` refuses every server call.
  - Invitations, address lookup and map previews are off.
  - Nothing is uploaded, and no analytics run.
- **Persistent banner:** "Demo workspace — fictional data". The banner offers:
  - a warning not to enter confidential information;
  - **View as** (role preview);
  - **Automation modes** (prepared examples only);
  - **Reset demo**, **Create my company** and **Exit demo**.
  On phones, the controls sit behind **Demo options**.
- **Role preview** filters the local view like the server does. The field view
  shows only one fictional driver's work. The preview never touches
  memberships or the server.
- **Seed version changes** replace an outdated demo, with a notice. Blocked
  storage shows an explanation.
- **Create my company** offers a choice of starting structure: blank,
  portable toilets, fuel, septic, or all three.
  - The server generates the structure from the reviewed templates: fields,
    forms, workflow and modules.
  - It never accepts state from the client.
  - Records, people, prices, attachments, credentials and integrations are
    never copied.

### Decisions

- Demo storage is per account in the browser. Clearing it or using another
  device starts a fresh demo. Local separation is not protection against
  someone who controls the same browser.
- A company created from a structure gets fresh identifiers. Nothing is
  remapped from the demo because nothing is copied from it.

### Verification

| Check | Result |
| --- | --- |
| `tests/demo.test.cjs`: the recipe runs through the rules, is fictional, covers all three trades, and gives the same structure every time | pass |
| `tests/companies-server.test.cjs`: structure-only creation ignores client-sent data; demo ids are refused by every protected route; no paid calls | pass |
| `tests/demo.browser.cjs`: no server or third-party requests, reset touches only demo storage, role preview, separate accounts, an account with a real company, outdated seed, blocked storage, structure-only creation, keyboard, phone | pass |

Screenshots: `docs/screenshots/rigo-b-*.png`.

## 5. Milestone C — reliable service-specific operations

### What changed

- **Quantities kept apart.** Completing a job records:
  - `requestedQuantity`: what was booked, captured before completion;
  - `actualQuantity`: what was delivered or done;
  - `billableQuantity`: what is charged; the job's `quantity` stays the billed
    amount for compatibility;
  - `equipmentQuantity`: units on the job.
  Invoices keep the requested and actual amounts next to the billed amount.
- **Billing a different quantity** is an explicit owner or administrator
  choice at completion, with a required reason that is stored on the job.
  Fixed-price services always bill 1. Without an override, billed equals
  actual.
- **No $0 invoices.** Completed work booked without a price shows **Needs a
  price** in Ready to invoice. An owner or administrator confirms a price and
  a reason, which are recorded in `priceHistory`. Invoicing is then
  available. Rigo never guesses prices, and confirmed prices can't change
  once invoiced.
- **Completion form** shows the requested amount. A completed job summarizes
  requested, delivered and billed amounts, plus units.
- **Demo:** billing is enabled, a diesel job delivered less than requested,
  and one job has no price yet.

### Preserved

- Completed jobs and invoices are snapshots. Service price changes never
  recalculate them.
- Jobs completed before this change are not given invented requested amounts.
- Workflow versions are unchanged.

### Verification

- `tests/operations.test.cjs` (5 tests): quantities, authority and reasons,
  price confirmation, no recalculation, the demo example.
- `tests/operations.browser.cjs`: the needs-a-price dialog with validation,
  the requested amount and the billable override.
- Screenshots: `docs/screenshots/rigo-c-*.png`.

### Not in this milestone

- Per-trade unit names beyond the existing service units (each, gallon,
  hour, visit). Owners can already add options to the unit field.
- Fees, taxes, minimums and cancellation charges. These need owner decisions
  and are not invented.

## 6. Milestone D: dashboard, exceptions, approvals, recurring work, automation

All of this is internal. Nothing sends messages, takes payments, calls paid
services or runs in the background.

The rules live in `lib/ops-source.js`. `npm run build` injects them into the
app bundle and extracts them into `lib/domain.cjs`, so the browser, the demo
and the server run the same rules. The screens live in `rigo-ops.js`.

### What changed

- **Today** (top of the Jobs page) for owners, administrators, dispatchers and
  viewers:
  - **Needs attention**: unassigned or overdue work with a suggested driver,
    declined jobs, reported problems, approvals waiting or changed, completed
    work without a price, and overdue invoices.
  - **Today's work** by status.
  - **Resources today**: drivers and free units.
  - **Invoices and payments**: invoiced, collected and outstanding, labelled
    as not profit.
  - **Recurring service** and **What Rigo did**.
  Every item opens its job.
- **My work today** for field employees. Each job shows when, service and
  quantity, where, resources, site contact and instructions. Drivers can
  accept or decline (with a reason), report a problem, or open the job to
  update or complete it.
- **Automation modes**, chosen by owners. The setup checklist asks for this.
  Settings are in App settings › Process builder:
  - a company default of Manual, Assisted or Automatic;
  - per-process overrides for assigning drivers and preparing invoices;
  - pause.
  Precedence: permissions, then readiness and approvals, then the existing
  workflow setting "Generate an invoice when a job is completed" (kept), then
  the process setting, then the company default. Paused never executes on its
  own. Suggestions pick the driver with the fewest jobs that day and never
  someone who declined. Automatic assignment also handles declines. Every
  automatic step is logged.
- **Approvals.** Owners set rules: invoices at or above an amount wait for an
  owner or administrator, with an optional backup.
  - An approval covers exactly the proposed quantity, price and total.
  - Any change marks it "changed", and a new request is needed.
  - Nothing is ever approved because time passed.
  - Approving creates exactly that invoice.
- **Reported problems** (equipment failure, site not accessible, running late,
  customer wants to cancel, information missing, could not deliver, other).
  - Drivers can report them only on their own jobs; the server checks this.
  - Dispatchers resolve them with an outcome and a note.
  - Owners can escalate a kind of problem to owners and administrators.
- **Recurring service**:
  - Service frequency (days, weeks or months) is separate from billing,
    which is per visit for now.
  - Each visit is its own job with its own history.
  - Planning is manual: "Plan visits for the next 2 weeks", at most two
    months ahead. It is idempotent, with one visit per series per date.
  - Visit dates are calendar dates in the series' time zone. Monthly visits
    on the 31st fall on the last day of shorter months.
  - Pause, resume and end are available. Pausing or ending archives upcoming
    unstarted, unassigned visits; nothing is deleted.
  - "This and future visits" changes only visits that have not started, are
    not assigned, and were not changed by hand.
- **Conflict checks** for the new actions compare only the job, approval or
  series involved, so unrelated saves don't cause false "changed elsewhere"
  errors. The demo compares against the previewed view, like the server.
- **Demo:** assisted mode, a weekly series with planned visits, an approval
  rule with a $1,700 invoice waiting, and a reported delay.

### Not in this milestone

- Monthly or consolidated billing for recurring work.
- Automatic planning on a schedule; there is no background scheduler.
- Approval rules for actions other than invoices.
- Live customer messages about delays; Milestone E covers communication.

### Verification

- `tests/automation.test.cjs` (9 tests): modes, suggestions, automatic
  assignment with pause and declines, precedence, unpriced auto-invoicing,
  approvals bound to proposals, escalation, recurring planning, future edits,
  pause and end, month ends.
- `tests/invitations.test.cjs`: drivers report problems only on their own
  jobs, can't change automation or approval rules, and see only their own
  work.
- `tests/today.browser.cjs`: approving the exact invoice, resolving a
  problem, idempotent planning, pause, a new series with validation,
  automation settings, a driver accepting, reporting and opening a job, and a
  phone-width check.
- Screenshots: `docs/screenshots/rigo-d-*.png`.

## 7. Milestone E: configuration model, templates, communication, imports, assistant

### What changed

- **One configuration model.** Setup changes are described as validated steps:
  `addList`, `addField`, `workflow`, `modules`, `labels`, `automation`,
  `approvalRule` and `exceptionRule`.
  - A proposal is dry-run against the current setup and previewed in plain
    words. It changes nothing until an owner or administrator applies it in
    App settings › Process builder.
  - Applying re-checks it and applies every step or none.
  - Steps already in place are skipped. A conflicting field type is refused.
  - Each underlying rule uses the reviewer's own role, so only owners can
    change automation or approval rules.
  - Workflow changes apply to new jobs only.
- **Assistants.** The built-in assistant is not set up: no AI provider or
  budget is chosen, and the `assistant` route answers "not set up" without
  calling anything. An AI assistant running in the owner's own browser can
  call the WebMCP tool `propose_configuration`. Its proposals wait for
  review, are treated as untrusted input, and are refused in the demo.
- **Templates** (tables `rigo_templates` and `rigo_template_versions`,
  function `rigo_publish_template`, applied in production 2026-10-06):
  - An owner saves the company's structure (list fields, job steps, modules,
    escalation, approval rules switched off) as a private template. They can
    share it with selected people by email; public sharing waits for
    moderation rules.
  - The server builds the content from the company. It never accepts content
    from the browser.
  - Versions are immutable. A company records the template and version it
    used and is never changed by a newer version.
  - Using a template in an existing company creates a reviewed proposal. New
    companies can start from a template.
- **Customer messages.** Owners opt in, which adds Email, Mobile phone and
  Contact by fields to Clients.
  - Rigo prepares messages from the company's wording for job booked, on the
    way (a chosen step), running late, completed and invoiced. Visit and
    payment reminders are prepared on request, once per day.
  - Each client's preference is respected, including "Do not contact".
  - Every message reads "Not sent: no email or SMS provider is connected",
    and the `messages` send route refuses. The outbox (on Today) offers copy
    and dismiss.
- **Imports** now warn about likely duplicates: names that match an existing
  record with a different ID, and repeated names in the file with different
  IDs.
- **Privacy:** field employees' view leaves out the outbox, approvals,
  proposals, automation log and recurring series. The demo preview does the
  same.

### Needs owner decisions (not invented)

- **AI provider, model and budget** for the built-in assistant.
- **Email/SMS provider** and sender identity (for example Postmark,
  SendGrid or Twilio). Environment variable names will be documented when
  chosen.
- **Moderation rules** for public templates.

### Verification

- `tests/config.test.cjs`: validation, preview, all-or-nothing, roles,
  skipped steps, new-jobs-only.
- `tests/messaging.test.cjs`: opt-in fields, preferences, never sent,
  idempotent reminders, dismissal.
- `tests/invitations.test.cjs`:
  - templates: structure only, no client-supplied content, sharing,
    versions, no silent updates, reviewed application, unsharing;
  - no message or AI calls;
  - field-employee privacy.
- `tests/setup.browser.cjs`: a reviewed proposal and apply, message opt-in,
  reminders, the outbox, and template save and review.
- Screenshots: `docs/screenshots/rigo-e-*.png`.

## 8. Progress

- [x] Milestone A — accounts and company foundation
- [x] Milestone B — isolated free demo
- [x] Milestone C — reliable service-specific operations
- [x] Milestone D — dashboard, exceptions, approvals, recurring work
- [x] Milestone E — configuration, imports, communication, templates (provider choices pending)
- [ ] Milestone F — authorized cross-company sharing (next)
- [ ] Milestone G — native distribution and billing (needs approval)
