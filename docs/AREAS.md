# Areas

The map of Rigo's code. A change reads one area's section here plus the `docs/PROCESS.md`
headings it needs. Paths are relative to the repository root; a path ending in `/` covers the
whole folder. `npm run check:docs` confirms every path and test listed here exists and that every
file under `src/`, `test/`, `e2e/`, `scripts/`, `migrations/`, `static/` and `.github/` belongs to
at least one area.

Area tests run with `npx vitest run <files>`. The full suite (about 10 minutes) runs on GitHub.

**Shared files** (see "Shared files" in `docs/PROCESS.md`): changing one of these means running
the tests of every area listed against it.
- `src/server/automation/engine.ts`: workflows, approvals-inbox, invoicing, jobs, rentals,
  collections.
- `src/server/modules/inbox.ts` (notification helpers): every area that tells people something;
  run the whole suite on GitHub and the tests of jobs, dispatch, driver, team, approvals-inbox.
- `src/server/modules/invoicing.ts`: invoicing, collections, rentals, workflows, jobs.
- `src/client/components/shell.tsx` (nav bar): every screen; run the browser check.

## accounts
Sign-in, sign-up, password reset, email confirmation, the account page, the workspace list and
accepting invitations.
- **Files:** `src/server/modules/accounts.ts`, `src/server/lib/common-passwords.ts`,
  `src/shared/password.ts`, `src/client/pages/auth.tsx`, `src/client/pages/account.tsx`,
  `src/client/pages/invite.tsx`, `src/client/pages/workspaces.tsx`, `src/client/lib/session.tsx`
- **Tests:** `test/accounts.test.ts`, `test/access.test.ts`, `test/security-phase2.test.ts`
- **Read also:** `docs/PRODUCT-VISION.md` (accounts and companies)

## company-setup
Creating a company, the setup checklist, settings, branding, business hours, archive and delete,
reusable structure and templates.
- **Files:** `src/server/modules/companies.ts`, `src/server/modules/structure.ts`,
  `src/server/modules/templates.ts`, `src/shared/branding.ts`, `src/shared/hours.ts`,
  `src/client/pages/setup.tsx`, `src/client/pages/settings.tsx`, `src/client/pages/templates.tsx`
- **Tests:** `test/setup-phase3.test.ts`, `test/access.test.ts`, `test/expansion.test.ts`

## team
Members, roles, invitations, approval delegations and the activity log.
- **Files:** `src/server/modules/team.ts`, `src/shared/activity.ts`, `src/client/pages/team.tsx`
- **Tests:** `test/team-phase2.test.ts`, `test/security-phase2.test.ts`, `test/access.test.ts`

## customers
Customers, locations and tanks, duplicates, merge and archive, the customer picker, and imports.
- **Files:** `src/server/modules/records.ts`, `src/server/modules/customer-merge.ts`,
  `src/server/modules/imports.ts`, `src/shared/customers.ts`, `src/shared/imports.ts`,
  `src/client/pages/customers.tsx`, `src/client/pages/imports.tsx`,
  `src/client/components/customer-picker.tsx`
- **Tests:** `test/customers-phase2.test.ts`, `test/imports-phase3.test.ts`,
  `test/navigation-phase3.test.ts`, `test/review-phase2.test.ts`, `test/review-phase3.test.ts`,
  `test/security-phase2.test.ts`

## services-pricing
Services, their fields and price lines, rates and tax. Money rules: stop and ask first.
- **Files:** `src/shared/services.ts`, `src/client/pages/services.tsx`,
  `src/server/modules/records.ts`
- **Tests:** `test/pricing.test.ts`, `test/domain.test.ts`, `test/setup-phase3.test.ts`

## jobs
Jobs, drafts and missing information, the job form and page, reschedule and the job report.
- **Files:** `src/server/modules/jobs.ts`, `src/shared/jobs.ts`, `src/shared/report.ts`,
  `src/client/pages/jobs.tsx`, `src/client/pages/jobform.tsx`, `src/client/pages/jobdetail.tsx`,
  `src/client/pages/job-report.tsx`
- **Tests:** `test/operations.test.ts`, `test/setup-phase3.test.ts`, `test/polish-phase3.test.ts`,
  `test/navigation-phase3.test.ts`

## dispatch
Home ("Needs you"), the live timeline, assignment, trucks and other resources, priority and late
jobs.
- **Files:** `src/server/modules/overview.ts`, `src/client/pages/dashboard.tsx`,
  `src/client/pages/resources.tsx`, `src/client/components/timeline.tsx`,
  `src/client/components/assign.tsx`, `src/client/components/trucks.tsx`,
  `src/server/modules/records.ts`
- **Tests:** `test/dispatch-phase2.test.ts`, `test/dispatch-approvals.test.ts`,
  `test/review-phase2.test.ts`, `test/polish-phase3.test.ts`

## driver
The driver's phone screens, offline records and sync, late records, hand-overs, fuel delivery
lines and what changed on a driver's job.
- **Files:** `src/server/modules/late-records.ts`, `src/shared/deliveries.ts`,
  `src/shared/changes.ts`, `src/client/pages/driver.tsx`, `src/client/pages/driver-records.tsx`,
  `src/client/lib/offline.ts`, `src/client/lib/autosync.ts`, `src/client/lib/draft-rev.ts`
- **Tests:** `test/driver-records.test.ts`, `test/fuel-phase2.test.ts`, `test/drafts.test.ts`,
  `test/operations.test.ts`, `test/dispatch-phase2.test.ts`

## invoicing
Preparing, approving, issuing and voiding invoices, payments, credit notes, the invoice page and
the public invoice link. Money rules: stop and ask first.
- **Files:** `src/server/modules/billing.ts`, `src/server/modules/invoicing.ts`,
  `src/server/modules/invoice-view.ts`, `src/shared/billing.ts`, `src/shared/invoices.ts`,
  `src/client/pages/invoices.tsx`, `src/client/pages/invoice-view.tsx`,
  `src/client/components/invoice-doc.tsx`
- **Tests:** `test/billing-lifecycle.test.ts`, `test/domain.test.ts`, `test/pricing.test.ts`,
  `test/security-review.test.ts`, `test/field-filtering.test.ts`

## collections
Balances, reminders, statements, customer credit and the customer account page. Money rules: stop
and ask first.
- **Files:** `src/server/modules/collections.ts`, `src/client/pages/collections.tsx`,
  `src/client/pages/customer-account.tsx`
- **Tests:** `test/billing-lifecycle.test.ts`, `test/money-review.test.ts`,
  `test/review-phase2.test.ts`

## rentals
Recurring service and rental plans: visits, units, pauses, early ends, deposits and rent credits.
- **Files:** `src/server/modules/recurring.ts`, `src/shared/rentals.ts`,
  `src/client/pages/recurring.tsx`
- **Tests:** `test/rentals.test.ts`, `test/money-review.test.ts`, `test/expansion.test.ts`

## workflows
Workflow definitions, validation, the builder and the automation engine.
- **Files:** `src/server/modules/workflows.ts`, `src/server/automation/engine.ts`,
  `src/server/automation/actions.ts`, `src/shared/workflows.ts`, `src/client/pages/workflows.tsx`,
  `src/client/pages/automation.tsx`
- **Tests:** `test/approvals-automation.test.ts`, `test/security-review.test.ts`

## approvals-inbox
Approvals, who may decide them, the inbox and notifications.
- **Files:** `src/server/modules/approvals.ts`, `src/server/modules/inbox.ts`,
  `src/client/pages/inbox.tsx`
- **Tests:** `test/approvals-automation.test.ts`, `test/dispatch-approvals.test.ts`,
  `test/security-review.test.ts`, `test/security-phase2.test.ts`

## messaging
Customer messages and emails, delivery states, email and text providers, the dev mailbox.
Anything that sends: stop and ask first.
- **Files:** `src/server/modules/messaging.ts`, `src/server/adapters/providers.ts`,
  `src/shared/messages.ts`, `src/shared/email.ts`, `src/client/pages/messages.tsx`,
  `src/client/pages/devmailbox.tsx`
- **Tests:** `test/providers-phase3.test.ts`, `test/privacy-phase3.test.ts`,
  `test/review-phase3.test.ts`, `test/language-phase3.test.ts`

## assistant
The assistant's answers and workflow proposals, and the AI adapter.
- **Files:** `src/server/modules/assistant.ts`, `src/server/adapters/ai.ts`,
  `src/shared/assistant.ts`, `src/shared/proposal.ts`, `src/client/pages/assistant.tsx`
- **Tests:** `test/assistant-phase3.test.ts`

## demo-landing
The landing page, the demo workspace and its guided walkthrough.
- **Files:** `src/server/modules/demo.ts`, `src/server/modules/demo-guide.ts`,
  `src/shared/demo.ts`, `src/client/pages/demo.tsx`, `src/client/pages/landing.tsx`,
  `static/landing/`, `scripts/landing-shots.mjs`
- **Tests:** `test/expansion.test.ts`

## platform
The server and client shells, permissions, language, time zones, the database and migrations,
tests' helpers and fixtures, the browser check, builds and GitHub workflows.
- **Files:** `src/server/main.ts`, `src/server/config.ts`, `src/server/vercel.ts`,
  `src/server/http/`, `src/server/db/`, `src/server/lib/util.ts`,
  `src/server/lib/zod-messages.ts`, `src/server/adapters/index.ts`, `src/shared/permissions.ts`,
  `src/shared/schedule.ts`, `src/shared/timezones.ts`, `src/shared/i18n/`,
  `src/client/App.tsx`, `src/client/main.tsx`, `src/client/index.html`, `src/client/styles.css`,
  `src/client/components/shell.tsx`, `src/client/components/ui.tsx`, `src/client/lib/api.ts`,
  `src/client/lib/form.ts`, `src/client/lib/format.ts`, `src/client/lib/i18n.tsx`,
  `src/client/lib/theme.ts`, `src/client/lib/title.ts`, `src/client/lib/unsaved.tsx`,
  `static/`, `migrations/`, `scripts/vercel-output.mjs`, `scripts/check-docs.mjs`,
  `e2e/run.mjs`, `test/helpers.ts`, `test/fixtures/`, `.github/`
- **Tests:** `test/access.test.ts`, `test/language-phase3.test.ts`,
  `test/field-filtering.test.ts`, `test/privacy-phase3.test.ts`, `test/security-review.test.ts`
- **Read also:** `docs/SCHEMA.md` for tables, `docs/DESIGN-SYSTEM.md` for tokens and components
