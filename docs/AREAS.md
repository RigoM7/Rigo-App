# Areas of the app

Used by `/change <area> ...`. Read only the section for your area:
`grep -n -A8 "^## <area>$" docs/AREAS.md`. Tables are described in `docs/SCHEMA.md`.
Paths are starting points: if a change needs a file that isn't listed, add it here in the same change.

Shared by every area: `src/server/http/context.ts` (permissions, `company_id` scoping),
`src/client/components/ui.tsx` and `shell.tsx`, `src/client/styles.css`, `test/helpers.ts`.

## jobs
- Client: `pages/jobs.tsx`, `jobdetail.tsx`, `jobform.tsx`, `driver.tsx`; `components/timeline.tsx`, `assign.tsx`
- Server: `modules/jobs.ts`, `modules/records.ts` | Shared: `shared/jobs.ts`, `schedule.ts`, `timezones.ts`
- Tables: jobs, job_resources, job_events, files
- Tests: `test/operations.test.ts` (jobs), `domain.test.ts` (job rules, schedules), `dispatch-approvals.test.ts` (priority, late jobs)

## invoices
- Client: `pages/invoices.tsx`
- Server: `modules/invoicing.ts`, `billing.ts` | Shared: `shared/billing.ts`
- Tables: invoices, invoice_lines, payments
- Tests: `domain.test.ts` (billing arithmetic, price lines), `operations.test.ts` (invoices and automation), `dispatch-approvals.test.ts` (invoice email)

## customers
- Client: `pages/customers.tsx`, `imports.tsx`
- Server: `modules/records.ts`, `imports.ts`
- Tables: customers, locations, imports
- Tests: `expansion.test.ts` (imports), `access.test.ts` (isolation)

## services
Service definitions, trucks/equipment/units, company structure.
- Client: `pages/services.tsx`, `resources.tsx`
- Server: `modules/structure.ts`, `records.ts`, `companies.ts` | Shared: `shared/services.ts`
- Tables: services, resources
- Tests: `domain.test.ts` (price lines), `operations.test.ts`

## automation
Workflows, approvals, the engine that runs them.
- Client: `pages/automation.tsx`, `workflows.tsx`
- Server: `modules/workflows.ts`, `approvals.ts`; `automation/engine.ts`, `actions.ts` | Shared: `shared/workflows.ts`, `proposal.ts`
- Tables: workflows, workflow_versions, events, automation_runs, actions, approvals, approval_delegations
- Tests: `domain.test.ts` (workflow rules), `dispatch-approvals.test.ts` (approval summaries), `operations.test.ts`

## inbox
Messages and notifications.
- Client: `pages/inbox.tsx`, `messages.tsx`
- Server: `modules/inbox.ts`, `adapters/index.ts` | Shared: `shared/email.ts`
- Tables: messages, notifications, dev_mailbox
- Tests: `dispatch-approvals.test.ts` (inbox counts, invoice email), `accounts.test.ts` (plain messages)

## team
People, roles, invitations.
- Client: `pages/team.tsx`, `invite.tsx`
- Server: `modules/team.ts` | Shared: `shared/permissions.ts`
- Tables: memberships, roles, invitations, approval_delegations
- Tests: `access.test.ts`

## account
Sign-in, passwords, recovery, company setup, settings and branding.
- Client: `pages/auth.tsx`, `account.tsx`, `workspaces.tsx`, `setup.tsx`, `settings.tsx`
- Server: `modules/accounts.ts`, `companies.ts` | Shared: `shared/password.ts`, `branding.ts`
- Tables: users, sessions, password_resets, email_tokens, auth_attempts, companies
- Tests: `accounts.test.ts`, `access.test.ts`, `domain.test.ts` (branding contrast)

## recurring
Recurring service and rentals.
- Client: `pages/recurring.tsx`
- Server: `modules/recurring.ts` | Shared: `shared/schedule.ts`
- Tables: recurring_plans, plan_occurrences
- Tests: `expansion.test.ts` (recurring, rentals billed every 28 days)

## templates
- Client: `pages/templates.tsx`
- Server: `modules/templates.ts`
- Tables: templates, template_shares, template_applications
- Tests: `expansion.test.ts` (templates)

## assistant
- Client: `pages/assistant.tsx`
- Server: `modules/assistant.ts`, `adapters/ai.ts`
- Tables: assistant_messages, usage_counters
- Tests: `expansion.test.ts` (assistant)

## dashboard
- Client: `pages/dashboard.tsx`
- Server: `modules/overview.ts`
- Tests: `operations.test.ts`

## demo
Demo workspace, public landing page, dev mailbox.
- Client: `pages/demo.tsx`, `landing.tsx`, `devmailbox.tsx`
- Server: `modules/demo.ts`, `demo-guide.ts` | Shared: `shared/demo.ts`
- Tests: `expansion.test.ts` (demo workspace), `dispatch-approvals.test.ts` (demo visits)

## new
A whole new area, or a change that spans several. Use the closest areas above as the starting
points, and add a section here when it exists.
