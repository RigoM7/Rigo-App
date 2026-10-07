# Schema

Every table in Rigo's `rigo` schema, what it holds, the area that owns it and the migration that
created it. Columns live in `migrations/`; read the migration before changing a table. Changes are
new numbered files in `migrations/` that only add (see "Database and live data" in
`docs/PROCESS.md`). `npm run check:docs` confirms this list matches the tables the migrations and
server code create.

`company_id` marks company-owned rows: every query on them is scoped by it.

| Table | Holds | Area | Created in |
|---|---|---|---|
| `schema_migrations` | Which migration files have been applied | platform | `src/server/db/index.ts` |
| `users` | People who can sign in | accounts | `001_init.sql` |
| `sessions` | Signed-in sessions (hashed cookie tokens) | accounts | `001_init.sql` |
| `password_resets` | Password reset links | accounts | `001_init.sql` |
| `auth_attempts` | Sign-in attempts for lockout and rate limits | accounts | `001_init.sql` |
| `email_tokens` | Email confirmation and email-change links | accounts | `002_account_recovery.sql` |
| `companies` | Companies, their settings and branding | company-setup | `001_init.sql` |
| `roles` | Each company's roles and their permissions | team | `001_init.sql` |
| `memberships` | Who belongs to which company, with which role | team | `001_init.sql` |
| `invitations` | Pending invitations to join a company | team | `001_init.sql` |
| `approval_delegations` | Approval authority handed to someone else | approvals-inbox | `001_init.sql` |
| `customers` | Customers, including archived and merged ones | customers | `001_init.sql` |
| `locations` | Customer sites and their tanks | customers | `001_init.sql` |
| `customer_merges` | Customer merges and what moved, for undo | customers | `014_customers.sql` |
| `resources` | Trucks, rental units and other equipment | dispatch | `001_init.sql` |
| `services` | Services, their fields and price lines | services-pricing | `001_init.sql` |
| `jobs` | Jobs and their state, schedule and recorded values | jobs | `001_init.sql` |
| `job_resources` | Which trucks or units a job uses | dispatch | `001_init.sql` |
| `job_events` | A job's history | jobs | `001_init.sql` |
| `pending_submissions` | Driver records waiting for the office to accept or dismiss | driver | `010_driver_records.sql` |
| `files` | Photos and other files attached to jobs or companies | jobs | `001_init.sql` |
| `invoices` | Invoices and their draft, approval, delivery and payment states | invoicing | `001_init.sql` |
| `invoice_lines` | Invoice lines | invoicing | `001_init.sql` |
| `invoice_credits` | Credit notes and customer credit taken off an invoice | invoicing | `007_billing_lifecycle.sql` |
| `invoice_links` | Expiring links to view an issued invoice without signing in | invoicing | `007_billing_lifecycle.sql` |
| `payments` | Payments, refunds and rejected payments | invoicing | `001_init.sql` |
| `credit_entries` | Customer credit ledger: overpayments, deposits, credit used | collections | `007_billing_lifecycle.sql` |
| `statements` | Customer statements | collections | `007_billing_lifecycle.sql` |
| `messages` | Customer messages and their delivery state | messaging | `001_init.sql` |
| `dev_mailbox` | Simulated emails shown at `/dev/mailbox` | messaging | `001_init.sql` |
| `workflows` | Workflows | workflows | `001_init.sql` |
| `workflow_versions` | Saved versions of each workflow | workflows | `001_init.sql` |
| `events` | Things that happened, which workflows react to | workflows | `001_init.sql` |
| `automation_runs` | Each workflow run | workflows | `001_init.sql` |
| `actions` | Each step a run takes | workflows | `001_init.sql` |
| `approvals` | Approval requests and decisions | approvals-inbox | `001_init.sql` |
| `notifications` | The bell: what each person is told | approvals-inbox | `001_init.sql` |
| `recurring_plans` | Recurring service and rental plans | rentals | `001_init.sql` |
| `plan_occurrences` | Visits generated from a plan | rentals | `001_init.sql` |
| `imports` | Uploaded import files and their review | customers | `001_init.sql` |
| `templates` | Company templates | company-setup | `001_init.sql` |
| `template_shares` | Who a template is shared with | company-setup | `001_init.sql` |
| `template_applications` | Templates applied to a company | company-setup | `001_init.sql` |
| `assistant_messages` | Assistant conversations | assistant | `001_init.sql` |
| `usage_counters` | Daily usage limits (for example AI answers) | platform | `001_init.sql` |
| `audit_log` | The activity log | team | `001_init.sql` |
| `system_state` | Server-wide settings and markers | platform | `001_init.sql` |
