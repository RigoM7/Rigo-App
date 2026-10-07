# Code map

Where everything is in the code. Find the area (the same names as `docs/FEATURES.md`), read only
that section, change its files, run its tests. Paths are relative to the repository root; a path
ending in `/` covers the whole folder. `[Template]` marks files only the field-service template
uses.

- Area tests: `npx vitest run <files>`. The full suite (about 10 minutes) and the browser check run
  on GitHub for every pull request.
- `npm run check:docs` keeps this map honest: every path, test and table named here exists, every
  file under `src/`, `test/`, `e2e/`, `scripts/`, `migrations/`, `static/` and `.github/` belongs to
  an area, every test file is some area's test, and the tables listed are exactly the tables the
  migrations and server code create.
- Tables: each area lists the tables it owns, what they hold and the migration that created them.
  Columns live in `migrations/`; read the migration before changing a table. `company_id` marks
  company-owned rows, and every query on them is scoped by it.

## Shared files

Used by many areas. After changing one, run the tests of every area listed against it and say so in
the pull request.
- `src/server/automation/engine.ts`: automation, approvals-inbox, invoicing, work-items,
  recurring-billing, payments.
- `src/server/modules/inbox.ts` (notification helpers): every area that tells people something; run
  the whole suite on GitHub and the tests of work-items, schedule, worker-app, people-and-roles and
  approvals-inbox.
- `src/server/modules/invoicing.ts`: invoicing, payments, recurring-billing, automation, work-items.
- `src/server/modules/records.ts`: customers, services-and-pricing, schedule.
- `src/client/components/shell.tsx` (navigation): every screen; run the browser check.

## accounts (code: accounts)
Sign-in, sign-up, password reset, email confirmation, the account page, the workspace list and
accepting invitations.
- **What it does:** `docs/FEATURES.md`, accounts.
- **Files:** `src/server/modules/accounts.ts`, `src/server/lib/common-passwords.ts`,
  `src/shared/password.ts`, `src/client/pages/auth.tsx`, `src/client/pages/account.tsx`,
  `src/client/pages/invite.tsx`, `src/client/pages/workspaces.tsx`, `src/client/lib/session.tsx`
- **Tables:**
  - `users`: People who can sign in (`001_init.sql`)
  - `sessions`: Signed-in sessions (hashed cookie tokens) (`001_init.sql`)
  - `password_resets`: Password reset links (`001_init.sql`)
  - `auth_attempts`: Sign-in attempts for lockout and rate limits (`001_init.sql`)
  - `email_tokens`: Email confirmation and email-change links (`002_account_recovery.sql`)
- **Tests:** `test/accounts.test.ts`, `test/access.test.ts`, `test/security-phase2.test.ts`
- **Shared files:** none.
- **Watch out:** sign-in, session and reset changes get `/security-review`. Session tokens and reset
  links are stored only as hashes. Account emails go through the email provider and fall back to
  owner-created reset links when none is set.

## workspace-setup (code: company-setup)
Creating a company, the setup checklist, settings, branding, business hours, archive and delete,
reusable structure and templates.
- **What it does:** `docs/FEATURES.md`, workspace-setup.
- **Files:** `src/server/modules/companies.ts`, `src/server/modules/structure.ts`,
  `src/server/modules/templates.ts`, `src/shared/branding.ts`, `src/shared/hours.ts`,
  `src/client/pages/setup.tsx`, `src/client/pages/settings.tsx`, `src/client/pages/templates.tsx`
- **Tables:**
  - `companies`: Companies, their settings and branding (`001_init.sql`)
  - `templates`: Company templates (`001_init.sql`)
  - `template_shares`: Who a template is shared with (`001_init.sql`)
  - `template_applications`: Templates applied to a company (`001_init.sql`)
- **Tests:** `test/setup-phase3.test.ts`, `test/access.test.ts`, `test/expansion.test.ts`
- **Shared files:** none.
- **Watch out:** templates carry structure only, never people, records, rates or files. A company's
  accent colour goes through `accentVariants()` in `src/shared/branding.ts`, which keeps text
  readable.

## people-and-roles (code: team)
Members, roles, invitations, approval delegations and the activity log.
- **What it does:** `docs/FEATURES.md`, people-and-roles.
- **Files:** `src/server/modules/team.ts`, `src/shared/activity.ts`, `src/client/pages/team.tsx`
- **Tables:**
  - `roles`: Each company's roles and their permissions (`001_init.sql`)
  - `memberships`: Who belongs to which company, with which role (`001_init.sql`)
  - `invitations`: Pending invitations to join a company (`001_init.sql`)
  - `audit_log`: The activity log (`001_init.sql`)
- **Tests:** `test/team-phase2.test.ts`, `test/security-phase2.test.ts`, `test/access.test.ts`
- **Shared files:** `src/server/modules/inbox.ts`.
- **Watch out:** the four role presets live in `src/shared/permissions.ts` (foundation); owners can
  edit a role's permissions but not add, rename or remove roles yet. The last active owner can't be
  removed or demoted. Permission changes get `/security-review`.

## customers (code: customers)
Customers, locations and tanks, duplicates, merge and archive, the customer picker, and imports.
- **What it does:** `docs/FEATURES.md`, customers.
- **Files:** `src/server/modules/records.ts`, `src/server/modules/customer-merge.ts`,
  `src/server/modules/imports.ts`, `src/shared/customers.ts`, `src/shared/imports.ts`,
  `src/client/pages/customers.tsx`, `src/client/pages/imports.tsx`,
  `src/client/components/customer-picker.tsx`
- **Tables:**
  - `customers`: Customers, including archived and merged ones (`001_init.sql`)
  - `locations`: Customer sites and their tanks (`001_init.sql`)
  - `customer_merges`: Customer merges and what moved, for undo (`014_customers.sql`)
  - `imports`: Uploaded import files and their review (`001_init.sql`)
- **Tests:** `test/customers-phase2.test.ts`, `test/imports-phase3.test.ts`,
  `test/navigation-phase3.test.ts`, `test/review-phase2.test.ts`, `test/review-phase3.test.ts`,
  `test/security-phase2.test.ts`
- **Shared files:** `src/server/modules/records.ts`.
- **Watch out:** contact details are removed on the server for roles without contact access. Imports
  never save anything until the person confirms the review.

## services-and-pricing (code: services-pricing)
Services, their fields and price lines, rates and tax.
- **What it does:** `docs/FEATURES.md`, services-and-pricing.
- **Files:** `src/shared/services.ts`, `src/client/pages/services.tsx`,
  `src/server/modules/records.ts`
- **Tables:**
  - `services`: Services, their fields and price lines (`001_init.sql`)
- **Tests:** `test/pricing.test.ts`, `test/domain.test.ts`, `test/setup-phase3.test.ts`
- **Shared files:** `src/server/modules/records.ts`.
- **Watch out:** service categories are fixed in `src/shared/services.ts` (fuel, portable toilet,
  septic, other), which ties services to the field-service template. Rates are stored in
  ten-thousandths of a dollar (`rateE4`); a missing rate holds an invoice, never prices it at 0.

## work-items (code: jobs)
Jobs, drafts and missing information, the job form and page, reschedule and the job report.
- **What it does:** `docs/FEATURES.md`, work-items.
- **Files:** `src/server/modules/jobs.ts`, `src/shared/jobs.ts`, `src/shared/report.ts`,
  `src/client/pages/jobs.tsx`, `src/client/pages/jobform.tsx`, `src/client/pages/jobdetail.tsx`,
  `src/client/pages/job-report.tsx`
- **Tables:**
  - `jobs`: Jobs and their state, schedule and recorded values (`001_init.sql`)
  - `job_events`: A job's history (`001_init.sql`)
  - `files`: Photos and other files attached to jobs or companies (`001_init.sql`)
- **Tests:** `test/operations.test.ts`, `test/setup-phase3.test.ts`, `test/polish-phase3.test.ts`,
  `test/navigation-phase3.test.ts`
- **Shared files:** `src/server/automation/engine.ts`, `src/server/modules/inbox.ts`,
  `src/server/modules/invoicing.ts`.
- **Watch out:** job states are fixed in `src/shared/jobs.ts` (draft, open, in progress, completed,
  partial, unsuccessful, cancelled); owner-built stages would replace them. Corrections keep history
  and make stale approvals invalid.

## schedule (code: dispatch)
Home ("Needs you"), the live timeline, assignment, trucks and other equipment, priority and late
jobs.
- **What it does:** `docs/FEATURES.md`, schedule.
- **Files:** `src/server/modules/overview.ts`, `src/client/pages/dashboard.tsx`,
  `src/client/pages/resources.tsx`, `src/client/components/timeline.tsx`,
  `src/client/components/assign.tsx`, `src/client/components/trucks.tsx`,
  `src/server/modules/records.ts`
- **Tables:**
  - `resources`: Trucks, rental units and other equipment (`001_init.sql`)
  - `job_resources`: Which trucks or units a job uses (`001_init.sql`)
- **Tests:** `test/dispatch-phase2.test.ts`, `test/dispatch-approvals.test.ts`,
  `test/review-phase2.test.ts`, `test/polish-phase3.test.ts`
- **Shared files:** `src/server/modules/inbox.ts`, `src/server/modules/records.ts`.
- **Watch out:** assignment never requires dragging (selects and buttons only). Times are shown in
  the company's time zone.

## worker-app (code: driver)
The worker's phone screens, offline records and sync, late records, hand-overs, fuel delivery lines
and what changed on a worker's job.
- **What it does:** `docs/FEATURES.md`, worker-app.
- **Files:** `src/server/modules/late-records.ts`, `src/shared/changes.ts`,
  `src/client/pages/driver.tsx`, `src/client/pages/driver-records.tsx`, `src/client/lib/offline.ts`,
  `src/client/lib/autosync.ts`, `src/client/lib/draft-rev.ts`,
  [Template] `src/shared/deliveries.ts` (fuel delivery lines)
- **Tables:**
  - `pending_submissions`: Driver records waiting for the office to accept or dismiss (`010_driver_records.sql`)
- **Tests:** `test/driver-records.test.ts`, `test/drafts.test.ts`, `test/operations.test.ts`,
  `test/dispatch-phase2.test.ts`, [Template] `test/fuel-phase2.test.ts`
- **Shared files:** `src/server/modules/inbox.ts`.
- **Watch out:** only the server's acceptance completes work; a draft saved on the phone is never
  "done". Offline data is kept per person and company and removed on sign-out.

## invoicing (code: invoicing)
Preparing, approving, issuing and voiding invoices, payments, credit notes, the invoice page and the
public invoice link.
- **What it does:** `docs/FEATURES.md`, invoicing.
- **Files:** `src/server/modules/billing.ts`, `src/server/modules/invoicing.ts`,
  `src/server/modules/invoice-view.ts`, `src/shared/billing.ts`, `src/shared/invoices.ts`,
  `src/client/pages/invoices.tsx`, `src/client/pages/invoice-view.tsx`,
  `src/client/components/invoice-doc.tsx`
- **Tables:**
  - `invoices`: Invoices and their draft, approval, delivery and payment states (`001_init.sql`)
  - `invoice_lines`: Invoice lines (`001_init.sql`)
  - `invoice_credits`: Credit notes and customer credit taken off an invoice (`007_billing_lifecycle.sql`)
  - `invoice_links`: Expiring links to view an issued invoice without signing in (`007_billing_lifecycle.sql`)
  - `payments`: Payments, refunds and rejected payments (`001_init.sql`)
- **Tests:** `test/billing-lifecycle.test.ts`, `test/domain.test.ts`, `test/pricing.test.ts`,
  `test/security-review.test.ts`, `test/field-filtering.test.ts`
- **Shared files:** `src/server/automation/engine.ts`, `src/server/modules/invoicing.ts`.
- **Watch out:** money is exact, in minor units, worked out in `src/shared/`; AI never computes it.
  A missing price holds the invoice. Amounts are removed on the server for roles without finance
  access. An approval is bound to the record version and the workflow version.

## payments (code: collections)
Balances, reminders, statements, customer credit and the customer account page.
- **What it does:** `docs/FEATURES.md`, payments.
- **Files:** `src/server/modules/collections.ts`, `src/client/pages/collections.tsx`,
  `src/client/pages/customer-account.tsx`
- **Tables:**
  - `credit_entries`: Customer credit ledger: overpayments, deposits, credit used (`007_billing_lifecycle.sql`)
  - `statements`: Customer statements (`007_billing_lifecycle.sql`)
- **Tests:** `test/billing-lifecycle.test.ts`, `test/money-review.test.ts`,
  `test/review-phase2.test.ts`
- **Shared files:** `src/server/automation/engine.ts`, `src/server/modules/invoicing.ts`.
- **Watch out:** reminders and statements are prepared messages; they are sent only through a
  configured provider. Only people who see billing read or send them.

## recurring-billing (code: rentals)
Recurring service and rental plans: visits, units, pauses, early ends, deposits and rent credits.
- **What it does:** `docs/FEATURES.md`, recurring-billing.
- **Files:** `src/server/modules/recurring.ts`, `src/client/pages/recurring.tsx`,
  [Template] `src/shared/rentals.ts` (rental units, periods and rent credits)
- **Tables:**
  - `recurring_plans`: Recurring service and rental plans (`001_init.sql`)
  - `plan_occurrences`: Visits generated from a plan (`001_init.sql`)
- **Tests:** `test/rentals.test.ts`, `test/money-review.test.ts`, `test/expansion.test.ts`
- **Shared files:** `src/server/automation/engine.ts`, `src/server/modules/invoicing.ts`.
- **Watch out:** the visit schedule and the billing schedule are separate. Generation is idempotent:
  running it twice never makes a second visit or invoice.

## automation (code: workflows)
Workflow definitions, validation, the builder and the automation engine.
- **What it does:** `docs/FEATURES.md`, automation.
- **Files:** `src/server/modules/workflows.ts`, `src/server/automation/engine.ts`,
  `src/server/automation/actions.ts`, `src/shared/workflows.ts`, `src/client/pages/workflows.tsx`,
  `src/client/pages/automation.tsx`
- **Tables:**
  - `workflows`: Workflows (`001_init.sql`)
  - `workflow_versions`: Saved versions of each workflow (`001_init.sql`)
  - `events`: Things that happened, which workflows react to (`001_init.sql`)
  - `automation_runs`: Each workflow run (`001_init.sql`)
  - `actions`: Each step a run takes (`001_init.sql`)
- **Tests:** `test/approvals-automation.test.ts`, `test/security-review.test.ts`
- **Shared files:** `src/server/automation/engine.ts`, `src/server/modules/invoicing.ts`.
- **Watch out:** every attempt rechecks pause, workflow version, membership, permission and
  capability; actions are idempotent; retries are bounded; timeouts never approve. Automatic mode
  never bypasses an approval.

## approvals-inbox (code: approvals-inbox)
Approvals, who may decide them, the inbox and notifications.
- **What it does:** `docs/FEATURES.md`, approvals-inbox.
- **Files:** `src/server/modules/approvals.ts`, `src/server/modules/inbox.ts`,
  `src/client/pages/inbox.tsx`
- **Tables:**
  - `approval_delegations`: Approval authority handed to someone else (`001_init.sql`)
  - `approvals`: Approval requests and decisions (`001_init.sql`)
  - `notifications`: The bell: what each person is told (`001_init.sql`)
- **Tests:** `test/approvals-automation.test.ts`, `test/dispatch-approvals.test.ts`,
  `test/security-review.test.ts`, `test/security-phase2.test.ts`
- **Shared files:** `src/server/automation/engine.ts`, `src/server/modules/inbox.ts`.
- **Watch out:** an approval naming someone can't be decided by anyone else, including from the
  invoice page. Unread and unresolved are counted separately.

## messages (code: messaging)
Customer messages and emails, delivery states, email and text providers, the test inbox.
- **What it does:** `docs/FEATURES.md`, messages.
- **Files:** `src/server/modules/messaging.ts`, `src/server/adapters/providers.ts`,
  `src/shared/messages.ts`, `src/shared/email.ts`, `src/client/pages/messages.tsx`,
  `src/client/pages/devmailbox.tsx`
- **Tables:**
  - `messages`: Customer messages and their delivery state (`001_init.sql`)
  - `dev_mailbox`: Simulated emails shown at `/dev/mailbox` (`001_init.sql`)
- **Tests:** `test/providers-phase3.test.ts`, `test/privacy-phase3.test.ts`,
  `test/review-phase3.test.ts`, `test/language-phase3.test.ts`
- **Shared files:** `src/server/modules/inbox.ts`.
- **Watch out:** providers stay off until their keys are set, and a company sends to customers only
  when listed in `RIGO_SENDING_COMPANIES`. Demo companies never reach a provider; their messages are
  Simulated.

## assistant (code: assistant)
The assistant's answers and workflow proposals, and the AI adapter.
- **What it does:** `docs/FEATURES.md`, assistant.
- **Files:** `src/server/modules/assistant.ts`, `src/server/adapters/ai.ts`,
  `src/shared/assistant.ts`, `src/shared/proposal.ts`, `src/client/pages/assistant.tsx`
- **Tables:**
  - `assistant_messages`: Assistant conversations (`001_init.sql`)
- **Tests:** `test/assistant-phase3.test.ts`
- **Shared files:** none.
- **Watch out:** real AI is off by default, never used in the demo and rate-limited per company;
  prepared answers are labeled. Company data is untrusted input to the AI. Proposals stay separate
  from active workflows until accepted, tested and switched on.

## demo-and-landing (code: demo-landing)
The landing page, the demo workspace and its guided walkthrough.
- **What it does:** `docs/FEATURES.md`, demo-and-landing.
- **Files:** `src/server/modules/demo.ts`, `src/server/modules/demo-guide.ts`,
  `src/client/pages/demo.tsx`, `src/client/pages/landing.tsx`, `static/landing/`,
  `scripts/landing-shots.mjs`, [Template] `src/shared/demo.ts` (the fuel, portable toilet and septic
  demo company)
- **Tables:** none of its own; the demo is an ordinary company marked as a demo.
- **Tests:** `test/expansion.test.ts`
- **Shared files:** none.
- **Watch out:** the demo never sends, charges, connects or calls a paid service; the server's
  provider boundary enforces it. Landing screenshots are regenerated with
  `scripts/landing-shots.mjs`.

## foundation (code: platform)
The server and client shells, permissions, language, time zones, the database and migrations, test
helpers and fixtures, the browser check, builds and GitHub workflows.
- **What it does:** `docs/FEATURES.md`, foundation.
- **Files:** `src/server/main.ts`, `src/server/config.ts`, `src/server/vercel.ts`,
  `src/server/http/`, `src/server/db/`, `src/server/lib/util.ts`,
  `src/server/lib/zod-messages.ts`, `src/server/adapters/index.ts`, `src/shared/permissions.ts`,
  `src/shared/schedule.ts`, `src/shared/timezones.ts`, `src/shared/i18n/`,
  `src/client/App.tsx`, `src/client/main.tsx`, `src/client/index.html`, `src/client/styles.css`,
  `src/client/components/shell.tsx`, `src/client/components/ui.tsx`, `src/client/lib/api.ts`,
  `src/client/lib/form.ts`, `src/client/lib/format.ts`, `src/client/lib/i18n.tsx`,
  `src/client/lib/theme.ts`, `src/client/lib/title.ts`, `src/client/lib/unsaved.tsx`,
  `static/`, `migrations/`, `scripts/vercel-output.mjs`, `scripts/vercel-ignore.sh`,
  `scripts/check-docs.mjs`, `e2e/run.mjs`, `test/helpers.ts`, `test/fixtures/`, `.github/`
- **Tables:**
  - `schema_migrations`: Which migration files have been applied (`src/server/db/index.ts`)
  - `usage_counters`: Daily usage limits (for example AI answers) (`001_init.sql`)
  - `system_state`: Server-wide settings and markers (`001_init.sql`)
- **Tests:** `test/access.test.ts`, `test/language-phase3.test.ts`,
  `test/field-filtering.test.ts`, `test/privacy-phase3.test.ts`, `test/security-review.test.ts`
- **Shared files:** `src/client/components/shell.tsx`.
- **Watch out:** the permission helpers in `src/server/http/context.ts` scope every company-owned
  query; non-members get 404. Tokens and components in `src/client/styles.css` and
  `src/client/components/` are described in `DESIGN.md`. `.claude/hooks/protect-migrations.sh` blocks
  editing a migration already on `main`.

## Recipes

### Add a feature end to end
1. Check `PRODUCT.md` (does it fit the vision?) and the area in `docs/FEATURES.md` (what exists).
2. Put the business rule in `src/shared/` so the server and the screen use the same code.
3. Add or change the server route in the area's module: scope every query by `company_id`, check
   the permission with the helpers in `src/server/http/context.ts`, remove financial and contact
   fields on the server.
4. Build the screen (next recipe) or change the existing one.
5. Add a test in the area's test file, including a permission or isolation case.
6. Update `docs/FEATURES.md` (the feature line and, if it closes a gap, the gap list) and this map
   (new files, tests or tables), then run `npm run check:docs`.

### Add a screen
1. Add the page in `src/client/pages/` and its route in `src/client/App.tsx`.
2. Add it to the navigation in `src/client/components/shell.tsx` (each role sees only what its
   permissions allow) and to the command menu if people jump to it.
3. Use the tokens in `src/client/styles.css` and the components in `src/client/components/`.
4. Give it loading, empty (with a next action), error (with retry), permission-denied and, where it
   applies, offline states.
5. Check it at 375, 768, 1024 and 1440 px, in light and dark, at 200% text and with the keyboard;
   extend `e2e/run.mjs` when it adds a key flow or page.

### Change the database
1. Add a new numbered file in `migrations/` (never edit one that is already on `main`; the hook
   blocks it). Migrations only add.
2. Add any new table to its area above, with what it holds and the new migration's name.
3. Keep the migration out of preview pushes: previews share the live database and migrations run on
   the first request. It is applied at launch.
4. Run `npm run check:docs` and the area's tests.

### Add something owners can configure
1. Store it as validated data, never as code, scripts, HTML or CSS: a zod schema in `src/shared/`
   and a JSON column or table scoped by `company_id`.
2. Validate on the server and explain problems in plain words.
3. Keep it in templates when it is structure (services, fields, roles, workflows), never when it is
   data (people, records, rates, files).
4. This is the path to `PRODUCT.md`'s custom vocabulary, roles and stages: today job states
   (`src/shared/jobs.ts`), service categories (`src/shared/services.ts`) and role presets
   (`src/shared/permissions.ts`) are fixed in code.

## Gotchas
- Migrations run on the first request to any deployment, previews included.
- Tests use embedded PostgreSQL (PGlite) unless `DATABASE_URL` is set; set it to run them on a real
  PostgreSQL server.
- On Vercel there is no always-on process: automation runs at the end of each state-changing request
  and in a daily cron (`/api/cron/tick`).
- Words people read come from `src/shared/i18n/` (English and Spanish); permission keys, field keys
  and validator wording are never shown (the browser check looks for them).
