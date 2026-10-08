# Rigo

One place to run your business, whatever it is. What Rigo is and the owner's decisions are in
`PRODUCT.md`; how it looks is `DESIGN.md`; how Claude works here is `CLAUDE.md`. This file is how
to run, check and ship it, and where everything is in the code.

Live site: https://rigo-app-dun.vercel.app

## Run it locally

Requires Node.js 22. No database server or API keys are needed.

```bash
npm install
npm run build      # build the web app into dist/
npm start          # API + web app on http://localhost:8787
```

Data persists in `./data/` across restarts (`RIGO_DATA_DIR=memory` keeps nothing). For development
with hot reload:

```bash
npm run dev        # API on :8787, web app on http://localhost:5173 (proxies /api)
```

Open the app, create an account, and either start a workspace or open a demo. Locally, invitation,
password-reset and email-confirmation emails are not sent: they appear in the **test inbox** at
`/dev/mailbox`. Set `APP_URL=http://localhost:8787` with `npm start`, or the emailed links point to
port 5173. To try the live site's behaviour (no email service):

```bash
NODE_ENV=production PORT=8788 RIGO_DATA_DIR=data/prodlike APP_URL=http://localhost:8788 npm start
```

There, password recovery works through reset links an owner creates from Settings, People.

### PostgreSQL instead of the embedded database

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/rigo
npm run migrate    # optional; migrations also run on first request
npm start
```

### Configuration

All optional; see `.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection. Without it, PGlite in `./data/db`. |
| `PORT` | Local server port (default 8787). |
| `APP_URL` | Base URL used in invitation and reset links. |
| `STORAGE_DRIVER` | `local` (default locally) or `database`. |
| `RIGO_DEV_MAILBOX` | `1` shows simulated emails at `/dev/mailbox` (default on outside production). |
| `CRON_SECRET` | Protects `/api/cron/tick` (daily: overdue reminders, clean-up) when set. |
| `RIGO_SUPPORT_EMAIL` | Shown on the password recovery page for owners with no other owner to ask. |
| `RIGO_TERMS_URL`, `RIGO_PRIVACY_URL` | Terms and privacy links at sign-up. Not set: no agreement line. |
| `RIGO_EMAIL_PROVIDER`, `RIGO_EMAIL_API_KEY`, `RIGO_EMAIL_FROM` | Email through `resend` or `postmark`. Turns on account emails, and customer emails for allowed workspaces. Off until all three are set. |
| `RIGO_SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Texts through `twilio`. Off until all four are set. |
| `RIGO_SENDING_COMPANIES` | Workspace ids (comma-separated) allowed to send to customers through the providers above, or `*`. Not set: nothing is sent; messages stay prepared. |
| `RIGO_DAILY_EMAIL_LIMIT`, `RIGO_DAILY_TEXT_LIMIT`, `RIGO_SMS_ANY_COUNTRY` | Daily ceilings per workspace (300 emails, 100 texts) and, with `1`, texts outside the US and Canada. |
| `RIGO_TRUST_PROXY` | `1` trusts `X-Forwarded-For` for client addresses. Automatic on Vercel. |

## Check your work

```bash
npm run typecheck                          # about 10 seconds
npx vitest run <files>                     # an area's tests, listed in the code map below
npm run check:docs                         # the code map matches the code
npm test                                   # the full suite on embedded PostgreSQL
DATABASE_URL=postgres://… npm test         # the same on a real PostgreSQL server

# Browser checks against a running server (uses the pre-installed Chromium):
npm run build && npm start &
BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) npm run test:browser
```

The browser check (`e2e/run.mjs`) walks the real flows, scans every screen with axe (WCAG 2.2 AA)
in both themes, and checks for sideways scrolling at 375, 768, 1024 and 1440px. `E2E_ONLY=<group>`
runs one group; screenshots of failures go to `e2e/output/`.

Every pull request runs the checks on GitHub (`.github/workflows/ci.yml`): the docs check always;
typecheck, the full suite and the build when code changes; the browser check when client files
change. "PR check" is the one job to require on `main`.

## Shipping to the live site

**Where it runs:** the Vercel project `rigo-app` (the live site above) and the Supabase project
`rigo-app`, schema `rigo` only. Vercel connects through the Supabase transaction pooler (port 6543)
as the `rigo_app` role, through `DATABASE_URL`; `APP_URL` sets the link base. `npm run build` on
Vercel also writes `.vercel/output` (`scripts/vercel-output.mjs`): the web app as static files and
the API as one Node.js function.

**The flow:**
1. Changes collect on one working branch with one draft pull request. Pushes in between start the
   commit's first line with `[checkpoint]`, so Vercel doesn't build them; GitHub still runs the
   checks.
2. **"Show me":** a push without `[checkpoint]` (and without new migrations) builds a Vercel preview.
3. **"Launch":** the checks pass, held migrations are applied to Supabase, the pull request is marked
   ready and merged into `main`, and Vercel deploys. After a production deployment,
   `.github/workflows/post-deploy.yml` loads the front page, the health endpoint and the sign-in
   page; on failure it opens an issue and prepares a revert pull request.

**Migrations and previews:** previews share the live database, and migrations run on the first
request to any deployment. So a new migration stays out of preview pushes and is applied at launch.

**Builds:** `scripts/vercel-ignore.sh` skips the Vercel build for a commit that only touches docs,
`.claude/`, `.github/` or the top-level docs, and, off `main`, for a commit whose first line
contains `[checkpoint]`.

**Background work on Vercel:** there is no always-on process. Automations run inside the request
that triggers them; the daily cron (`/api/cron/tick`) prepares overdue reminders and cleans up.
Locally the server does the same every hour.

## Stack

| Layer | Choice |
|---|---|
| Web app | React 19, React Router 7, TanStack Query, Vite, plain CSS with tokens (`DESIGN.md`), Lucide icons, self-hosted Bricolage Grotesque, Figtree and JetBrains Mono |
| API | Hono on Node.js 22 (TypeScript), zod validation |
| Sign-in | Own sessions: random 256-bit tokens stored as SHA-256, httpOnly SameSite=Lax cookies, bcrypt (cost 12), a CSRF header check |
| Database | PostgreSQL 16+ through `pg`; with no `DATABASE_URL`, embedded PostgreSQL (PGlite) in `./data/db` |
| Migrations | Ordered SQL files in `migrations/`, applied automatically under an advisory lock; they only add |
| Tests | Vitest (API and rules, against PGlite or PostgreSQL) and Playwright browser checks |

## Code map

Where each area lives. `npm run check:docs` keeps this honest: every path named here exists, every
file under `src/`, `test/`, `e2e/`, `scripts/`, `migrations/`, `static/` and `.github/` belongs to
an area, every test file is some area's test, and the tables listed are exactly the tables the
migrations and server code create. Company-owned tables carry `company_id`, and every query on them
is scoped by it with the helpers in `src/server/http/context.ts`. Read a table's migration before
changing it.

### accounts
Sign-up, sign-in with lockouts, password rules, recovery (email or an owner's reset link), email
confirmation and change, deleting an account, the workspace list and invitations to accept.
- **Files:** `src/server/modules/accounts.ts`, `src/server/lib/common-passwords.ts`, `src/shared/password.ts`,
  `src/shared/email.ts`, `src/client/pages/auth.tsx`, `src/client/pages/account.tsx`,
  `src/client/pages/invite.tsx`, `src/client/pages/workspaces.tsx`, `src/client/lib/session.tsx`
- **Tables:**
  - `users`: People who can sign in (`001_init.sql`)
  - `sessions`: Signed-in sessions, hashed cookie tokens (`001_init.sql`)
  - `password_resets`: Reset links, emailed or made by an owner (`001_init.sql`)
  - `auth_attempts`: Sign-in attempts and other rate limits (`001_init.sql`)
  - `email_tokens`: Email confirmation and email-change links (`002_account_recovery.sql`)
  - `dev_mailbox`: Simulated account emails shown at `/dev/mailbox` (`001_init.sql`)
- **Tests:** `test/accounts.test.ts`, `test/access.test.ts`
- **Watch out:** sign-in, session and reset changes get `/security-review`. Tokens and links are
  stored only as hashes.

### workspace-model
Creating a workspace from a template, the workspace's words, record types and custom fields, stages
with meaning tags, settings, archive and delete, the setup checklist, and word matching.
- **Files:** `src/server/modules/workspaces.ts`, `src/shared/workspace.ts`, `src/shared/templates.ts`,
  `src/shared/permissions.ts`, `src/client/pages/start.tsx`, `src/client/pages/settings.tsx`
- **Tables:**
  - `companies`: Workspaces, their words, settings and counters (`001_init.sql`)
  - `record_types`: Each workspace's record kinds and custom fields (`020_workspace_model.sql`)
  - `stages`: Owner-built stages of the main record, with meanings (`020_workspace_model.sql`)
- **Tests:** `test/workspace-model.test.ts`
- **Watch out:** a structure is validated as data (`structureSchema`, `stageProblems`); templates
  never carry prices, people or records. A stage holding work can't be removed.

### people-and-roles
Members, owner-built roles and permissions, invitations, owner reset links, notifications and the
activity log.
- **Files:** `src/server/modules/team.ts`, `src/server/modules/notify.ts`, `src/client/pages/people.tsx`
- **Tables:**
  - `roles`: Each workspace's roles, their app and permissions (`001_init.sql`)
  - `memberships`: Who belongs to which workspace, with which role (`001_init.sql`)
  - `invitations`: Invitations to join (`001_init.sql`)
  - `notifications`: What each person is told inside Rigo (`001_init.sql`)
  - `audit_log`: The activity log (`001_init.sql`)
- **Tests:** `test/team.test.ts`
- **Watch out:** the Owner role always exists and the last owner can't leave. Only owners change
  roles. Worker-app roles keep only worker permissions (`effectivePermissions`).

### work-and-schedule
The main work record: list, stages board, calendar, the lane-per-person timeline, assigning people
and equipment, what it charges for, history, Today and search.
- **Files:** `src/server/modules/work.ts`, `src/server/modules/search.ts`, `src/client/pages/work.tsx`,
  `src/client/pages/today.tsx`, `src/client/components/fields.tsx`
- **Tables:**
  - `work_items`: The main record and its stage, time, fields and billing state (`021_work_and_customers.sql`)
  - `work_assignees`: Who is assigned (`021_work_and_customers.sql`)
  - `work_equipment`: Which equipment is assigned (`021_work_and_customers.sql`)
  - `work_lines`: What the work charges for (`021_work_and_customers.sql`)
  - `work_history`: Each item's history (`021_work_and_customers.sql`)
  - `equipment`: Vehicles, tools, chairs or rooms (`021_work_and_customers.sql`)
- **Tests:** `test/work.test.ts`
- **Watch out:** moves follow the owner's paths and required fields (`moveProblem`); workers move
  only their own open work and never cancel. Assigning never needs dragging.

### customers
Customers, their places and contacts, history, next visit and what they owe, duplicates and archive.
- **Files:** `src/server/modules/customers.ts`, `src/shared/customers.ts`, `src/client/pages/customers.tsx`
- **Tables:**
  - `clients`: Customers (`021_work_and_customers.sql`)
  - `client_places`: Where work happens for a customer (`021_work_and_customers.sql`)
  - `client_contacts`: More people to reach at a customer (`021_work_and_customers.sql`)
- **Tests:** `test/work.test.ts`
- **Watch out:** contact details are removed on the server without `customers.contact`; amounts
  without `money.view` (`src/server/lib/redact.ts`).

### worker-app
The phone screens for workers: Today, Upcoming and Done, one action at a time, offline records that
send themselves when signal returns.
- **Files:** `src/server/modules/worker.ts`, `src/client/pages/worker.tsx`, `src/client/lib/offline.ts`,
  `src/client/lib/autosync.ts`, `src/client/lib/draft-rev.ts`
- **Tables:**
  - `worker_submissions`: Records sent from phones, so a retry applies once (`021_work_and_customers.sql`)
- **Tests:** `test/worker.test.ts`, `test/drafts.test.ts`
- **Watch out:** only the server's acceptance moves work. Offline data is keyed by person and
  workspace and removed on sign-out (unsent records stay, under their owner only).

### money
The price list, invoices built from finished work with exact totals, holds, approval, issuing,
voiding, payments, what is owed by age, invoice settings.
- **Files:** `src/server/modules/billing.ts`, `src/shared/money.ts`, `src/shared/invoices.ts`, `src/client/pages/money.tsx`
- **Tables:**
  - `catalog_items`: What a workspace sells and its price (`021_work_and_customers.sql`)
  - `money_invoices`: Invoices and their state (`022_money.sql`)
  - `money_invoice_lines`: Invoice lines (`022_money.sql`)
  - `money_invoice_work`: Which work an invoice bills, once (`022_money.sql`)
  - `money_payments`: Payments received (`022_money.sql`)
- **Tests:** `test/money.test.ts`, `test/money-math.test.ts`
- **Watch out:** money is exact, in minor units, worked out in `src/shared/money.ts`; a missing price
  or tax rate holds the invoice; an approval is for the version seen.

### automation-and-inbox
Assisted automation (Manual, Assisted, Automatic per workspace and per automation, pause, take
over), the approvals inbox, messages to customers and the provider boundary.
- **Files:** `src/server/modules/automation.ts`, `src/shared/automation.ts`, `src/server/adapters/index.ts`,
  `src/server/adapters/providers.ts`, `src/client/pages/automation.tsx`, `src/client/pages/inbox.tsx`
- **Tables:**
  - `auto_rules`: Each automation's level in a workspace (`023_automation.sql`)
  - `auto_actions`: What Rigo prepared or did, and what people decided (`023_automation.sql`)
  - `outbox_messages`: Messages to customers and what really happened to them (`023_automation.sql`)
- **Tests:** `test/automation.test.ts`
- **Watch out:** nothing approves itself; the safest level wins; Automatic on money needs an owner's
  confirmation; demos only simulate; nothing is "sent" unless a provider accepted it.

### booking-and-templates
The public booking and request page, requests in the inbox, and the shared template library.
- **Files:** `src/server/modules/booking.ts`, `src/server/modules/library.ts`, `src/shared/booking.ts`,
  `src/shared/hours.ts`, `src/client/pages/booking-public.tsx`
- **Tables:**
  - `booking_pages`: A workspace's public page (`024_booking_and_library.sql`)
  - `requests`: What came in from it (`024_booking_and_library.sql`)
  - `library_templates`: Templates owners published (`024_booking_and_library.sql`)
- **Tests:** `test/booking.test.ts`
- **Watch out:** the public page never shows prices, people or other customers; requests are rate
  limited and a hidden field catches bots.

### landing-and-demos
The front page and demos of any template, with sample data on request.
- **Files:** `src/client/pages/landing.tsx`, `src/server/modules/demo.ts`, `src/server/modules/samples.ts`,
  `src/shared/samples.ts`
- **Tables:** none of its own; a demo is a workspace of kind `demo`.
- **Tests:** `test/demo.test.ts`
- **Watch out:** demos never send, charge, connect or call a paid service.

### foundation
The server and web-app shells, isolation helpers, the database and migrations, the component kit
and tokens, builds, the browser check and GitHub workflows.
- **Files:** `src/server/main.ts`, `src/server/config.ts`, `src/server/vercel.ts`, `src/server/http/`,
  `src/server/db/`, `src/server/lib/util.ts`, `src/server/lib/redact.ts`, `src/server/lib/zod-messages.ts`,
  `src/shared/schedule.ts`, `src/shared/timezones.ts`, `src/client/App.tsx`, `src/client/main.tsx`,
  `src/client/index.html`, `src/client/styles.css`, `src/client/components/ui.tsx`,
  `src/client/components/shell.tsx`, `src/client/lib/api.ts`, `src/client/lib/theme.ts`,
  `src/client/lib/title.ts`, `src/client/lib/format.ts`, `src/client/lib/form.ts`, `static/`,
  `migrations/`, `scripts/`, `e2e/run.mjs`, `test/helpers.ts`, `test/fixtures/`, `.github/`
- **Tables:**
  - `schema_migrations`: Which migration files have been applied (`src/server/db/index.ts`)
  - `system_state`: Server-wide markers (`001_init.sql`)
- **Tests:** `test/access.test.ts`
- **Watch out:** `loadCompanyCtx` in `src/server/http/context.ts` scopes every request to one
  workspace; non-members get 404. `.claude/hooks/protect-migrations.sh` blocks editing a migration
  already on `main`.

### Old tables
Left by the earlier field-service app. Nothing reads or writes them; the owner approves dropping
them in a clean-up at launch.
  - `approval_delegations`: (`001_init.sql`)
  - `customers`: (`001_init.sql`)
  - `locations`: (`001_init.sql`)
  - `resources`: (`001_init.sql`)
  - `services`: (`001_init.sql`)
  - `jobs`: (`001_init.sql`)
  - `job_resources`: (`001_init.sql`)
  - `job_events`: (`001_init.sql`)
  - `files`: (`001_init.sql`)
  - `invoices`: (`001_init.sql`)
  - `invoice_lines`: (`001_init.sql`)
  - `payments`: (`001_init.sql`)
  - `messages`: (`001_init.sql`)
  - `workflows`: (`001_init.sql`)
  - `workflow_versions`: (`001_init.sql`)
  - `events`: (`001_init.sql`)
  - `automation_runs`: (`001_init.sql`)
  - `actions`: (`001_init.sql`)
  - `approvals`: (`001_init.sql`)
  - `recurring_plans`: (`001_init.sql`)
  - `plan_occurrences`: (`001_init.sql`)
  - `imports`: (`001_init.sql`)
  - `templates`: (`001_init.sql`)
  - `template_shares`: (`001_init.sql`)
  - `template_applications`: (`001_init.sql`)
  - `assistant_messages`: (`001_init.sql`)
  - `usage_counters`: (`001_init.sql`)
  - `credit_entries`: (`007_billing_lifecycle.sql`)
  - `invoice_credits`: (`007_billing_lifecycle.sql`)
  - `statements`: (`007_billing_lifecycle.sql`)
  - `invoice_links`: (`007_billing_lifecycle.sql`)
  - `pending_submissions`: (`010_driver_records.sql`)
  - `customer_merges`: (`014_customers.sql`)

## Recipes

**Add a feature end to end.** Check `PRODUCT.md`. Put the rule in `src/shared/` so the server and
the screens share it. Add the route in the area's module: scope every query by `company_id`, check
the permission with the helpers in `src/server/http/context.ts`, remove contact and money fields on
the server (`src/server/lib/redact.ts`). Build the screen with the components in
`src/client/components/` and the workspace's words (`useWorkspace().words`). Add tests, including a
permission or isolation case. Update `PRODUCT.md` (what it does) and this map.

**Add a screen.** Add the page in `src/client/pages/` and its route in `src/client/App.tsx`. Give it
loading, empty (with the next action), error (with retry) and permission states, one main action,
and nothing the person can't use. Check it at 375, 768, 1024 and 1440px in both themes; extend
`e2e/run.mjs` for a key flow.

**Change the database.** Add a new numbered file in `migrations/` that only adds; never edit one on
`main`. List new tables above. Keep it out of preview pushes; it is applied at launch.
