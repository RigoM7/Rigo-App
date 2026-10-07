# Rigo

## What Rigo is

Rigo is a place where a business runs its work. An owner creates a workspace, invites the team,
sets up services and workflows, and chooses how much Rigo does on its own (preparing invoices,
telling people what changed, drafting messages), while keeping control through approvals, pause
and takeover. Today Rigo is built around field service, with fuel delivery, portable toilets and
septic as the first template; the goal is any business (`PRODUCT.md`).

Live site: https://rigo-app-dun.vercel.app

## What works today

The full, area-by-area record is `docs/FEATURES.md`.
- Accounts, several workspaces per person, invitations by email, four roles with editable
  permissions, an activity log.
- Customers and locations with duplicate detection, merge and CSV imports.
- Jobs with drafts, priority and late flags; a live schedule timeline with a lane per worker.
- A phone view for workers that works offline: today's work, photos, signatures, payment at the stop.
- Invoices with exact totals, holds when a price is missing, approvals, payments, credit,
  collections, reminders and statements.
- Recurring service and rentals with separate visit and billing schedules.
- Workflows (Manual, Assisted, Automatic) with versions, tests, pause and takeover.
- An assistant that answers from the company's data and proposes workflows.
- Templates (private, shared, public) and a guided demo of a field-service business.
- Simulated or off until set up: email and texts, real AI, payment processing, maps.

## Glossary

One name for each thing, used the same way in the menu, page titles, buttons, messages and docs.
When a screen needs a new word, add it here first. Spanish names are in `src/shared/i18n/es.ts` and
still need review by a Spanish speaker.

### Work

| Use | Not | Meaning |
| --- | --- | --- |
| **Job** | ticket, order, work order, task | One piece of work for a customer at one location: a delivery, a pump-out, a unit service. Numbered (`#54`). |
| **Visit** | stop (in office text), trip | The driver being on site for a job. "The visit could not be completed." A job has one visit; a follow-up is a new job. |
| **Stop** | visit (on the driver side) | A job on a driver's list for the day, in order ("Today's stops in order"). Driver screens only. |
| **Draft** | pending, incomplete | A job that still lacks something it needs (a customer, a service or a required field). Drivers never see drafts. |
| **Open** | scheduled, active | A complete job, ready to be assigned and done. |
| **In progress** | started, active | The driver has started the job. |
| **Completed / Partially completed / Unsuccessful visit / Cancelled** | done, failed, closed | How a job ended. "Unsuccessful" is never billed automatically. |
| **Unassigned** | no driver yet, not assigned, open slot | A job without a driver. |
| **On my way** | en route, dispatched | The driver has said they are heading to the job, with an optional arrival estimate. |
| **Hand over** | transfer, reassign (by the driver) | A driver giving their job to another driver. Office staff **reassign**. |
| **Recurring service & rentals** | recurring & rentals, plans, schedules | Work that repeats (a weekly pump-out) and units out on rent, billed per 28-day cycle. |
| **Priority: Normal / Urgent / Emergency** | high, critical, ASAP | How soon a job must be done. Emergencies go to the top of the driver's list. |

### People and places

| Use | Not | Meaning |
| --- | --- | --- |
| **Customer** | client, account | Who the work is for and who is billed. |
| **Location** | site, address (as a thing) | A place where work happens for a customer. A customer can have several. |
| **Site contact** | contact (alone) | The person to call at a location. |
| **Billing contact** | AP, accounts payable contact | Who receives invoices when it isn't the main contact. |
| **Team member** | user, staff, employee | Someone with access to the company. |
| **Owner / Dispatcher / Driver / Office (billing)** | admin, manager, tech | The standard roles. Owners can always do everything. |
| **Trucks & equipment** | resources, assets, fleet items | Trucks, trailers and units (portable toilets, hand-wash stations). "Truck" alone is fine when it is a truck. |

### Money

| Use | Not | Meaning |
| --- | --- | --- |
| **Invoice** | bill, statement (for one job) | What the customer owes for one or more jobs or a rental cycle. |
| **Invoice draft** | pending invoice | Prepared but not issued; can still change. |
| **On hold** | blocked, error | An invoice that needs a person (a missing rate, an unusual quantity). It shows why. |
| **Approve / Issue** | finalize, send | Approve: a person agrees with the amounts. Issue: it gets its number and is owed. |
| **Void** | delete, cancel (an invoice) | An issued invoice that no longer applies. It keeps its number. |
| **Payment / Credit** | receipt, refund (for credit) | Money received; extra becomes credit for the next invoice. |
| **Statement** | account summary | A customer's open invoices and recent payments as of a date. |
| **Reminder** | dunning, notice | A prepared message about an invoice due soon or overdue. |
| **Rate** | price (for a unit) | The amount per gallon, per unit or per job. **Price** is fine in everyday sentences. |

### Messages and automation

| Use | Not | Meaning |
| --- | --- | --- |
| **Message** | communication, notification (to customers) | An email or text to a customer. Always **prepared** first. |
| **Prepared / Sent / Simulated** | queued, delivered (unless it was) | Prepared: written, not sent. Sent: a service accepted it. Simulated: demo, nothing left Rigo. |
| **Text** | SMS | A text message. |
| **Notification** | alert, message (to the team) | Something in the bell for a team member. |
| **Workflow** | automation rule, recipe | A rule: when something happens, what Rigo prepares or does. |
| **Automation** | engine, bot | The page showing workflows running, what waits for a person, and the pause switch. |
| **Approval** | sign-off, review request | A workflow step waiting for a person to decide. |
| **Assistant** | AI, chatbot | Answers questions from your data and drafts workflows. Says when an answer is prepared rather than AI. |

### Setup

| Use | Not | Meaning |
| --- | --- | --- |
| **Company** | workspace (in sentences), tenant, org | A business in Rigo. The list of companies is **Workspaces**. |
| **Services & pricing** | products, catalog | What the company offers, the form the driver fills in, and how each is priced. |
| **Template** | blueprint, preset | A copy of a company's structure (services, fields, roles, workflows), never its customers or records. |
| **Import** | upload, migration | Bringing customers or equipment in from a CSV file, reviewed before anything is saved. |
| **Test inbox** | simulated mailbox, dev mailbox | On a local copy, where account emails appear instead of being sent. |

### Shipping (words used with Claude, not in the app)

| Word | Meaning |
| --- | --- |
| **Working branch** | The one branch where pending changes collect, with one draft pull request. |
| **Checkpoint** | A commit whose first line contains `[checkpoint]`; Vercel doesn't build it. |
| **Preview** | A temporary copy of the working branch on Vercel, built on "show me". |
| **Launch** | Merging the working branch into `main`, which deploys the live site. |
| **Migration** | A numbered SQL file in `migrations/` that adds to the database schema. |

### Words never shown to people

Permission keys (`jobs.view_all`), action and trigger keys (`invoice.prepare`, `job.completed`),
field keys (`requested_qty`), raw time zone IDs (`America/Chicago`), "(cents)", "Invalid input" and
other validator wording. The browser suite checks every page for them.

## Run it locally

Requires Node.js 22. No database server or API keys are needed.

```bash
npm install
npm run build      # build the web app into dist/
npm start          # API + web app + worker on http://localhost:8787
```

Data persists in `./data/` across restarts. For development with hot reload:

```bash
npm run dev        # API on :8787, web app on http://localhost:5173 (proxies /api)
```

Then open the app, create an account, and either **Explore the demo** or **Create a company**.
Locally, invitation, password-reset and email-confirmation emails are not sent: they appear in the
**test inbox** at `/dev/mailbox`. Set `APP_URL=http://localhost:8787` when using `npm start`, or
the emailed links point to the dev server on port 5173.

To try the live site's behavior (no email service), run a production-like copy:

```bash
NODE_ENV=production PORT=8788 RIGO_DATA_DIR=data/prodlike APP_URL=http://localhost:8788 npm start
```

There, password recovery works through reset links an owner creates from Team.

### Use PostgreSQL instead of the embedded database

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
| `APP_URL` | Base URL used in invitation/reset links. |
| `STORAGE_DRIVER` | `local` (default locally) or `database`. |
| `RIGO_DEV_MAILBOX` | `1` shows simulated emails at `/dev/mailbox` (default on outside production). |
| `RIGO_AI_PROVIDER`, `ANTHROPIC_API_KEY`, `RIGO_AI_MODEL`, `RIGO_AI_DAILY_LIMIT` | Turn on real AI for real (non-demo) companies. Off by default. |
| `CRON_SECRET` | Protects `/api/cron/tick` when set. |
| `RIGO_SUPPORT_EMAIL` | Shown on the password recovery page for owners who have no other owner to ask. Not set: that line is left out. |
| `RIGO_TERMS_URL`, `RIGO_PRIVACY_URL` | Terms of service and privacy policy, linked at sign-up. Not set: no agreement line is shown. |
| `RIGO_EMAIL_PROVIDER`, `RIGO_EMAIL_API_KEY`, `RIGO_EMAIL_FROM` | Email through `resend` or `postmark`, from a verified sender such as `Tri-County <billing@yourdomain.com>`. Turns on password reset, invitation and confirmation emails, and customer emails for allowed companies. Off until all three are set. |
| `RIGO_SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Text messages through `twilio` ("On my way", updates, messages to customers). Off until all four are set. |
| `RIGO_SENDING_COMPANIES` | Company ids (comma-separated; the id is in the address bar after `/c/`) allowed to send to customers through the providers above, or `*` for all. Not set: no company sends; messages stay prepared. Keeps strangers who sign up from using your accounts. |
| `RIGO_DAILY_EMAIL_LIMIT`, `RIGO_DAILY_TEXT_LIMIT`, `RIGO_SMS_ANY_COUNTRY` | Daily ceilings per company (300 emails, 100 texts) and, with `1`, texts to numbers outside the US and Canada. |
| `RIGO_TRUST_PROXY` | `1` trusts `X-Forwarded-For` for client addresses (sign-in limits). Automatic on Vercel, which overwrites the header. |

## Check your work

```bash
npm run typecheck                          # about 5 seconds
npx vitest run <files>                     # an area's tests, listed in docs/CODEMAP.md
npm run check:docs                         # docs/CODEMAP.md matches the code
npm test                                   # the full API/domain suite on embedded PostgreSQL (about 10 minutes)
DATABASE_URL=postgres://… npm test         # the same tests on a real PostgreSQL server

# Browser checks against a running server (uses the pre-installed Chromium):
npm run build && npm start &
BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) npm run test:browser
```

Browser-check options: `NOEMAIL_URL=http://localhost:8788` (the production-like copy above) also
checks recovery without email; `E2E_ONLY=<group>` (`auth`, `round2`, `phase1`) runs one group.
Screenshots go to `e2e/output/`.

Every pull request runs the checks on GitHub (`.github/workflows/ci.yml`): the docs check always;
typecheck, the full suite and the build when code changes; the browser check when client files
change. What the checks cover, and the latest results, are in `docs/FEATURES.md`.

## Shipping to the live site

**Where it runs:** the Vercel project `rigo-app` (the live site above) and the Supabase project
`rigo-app`, schema `rigo` only. Vercel connects through the Supabase transaction pooler (port 6543)
as the dedicated `rigo_app` role, through the `DATABASE_URL` environment variable; `APP_URL` sets
the production link base. `npm run build` on Vercel also writes `.vercel/output`
(`scripts/vercel-output.mjs`): the web app as static files and the API as one Node.js function. The
old `public.rigo_*` tables belong to an earlier app and are unused.

**The flow:**
1. Changes collect on one working branch with one draft pull request. Pushes in between start the
   commit's first line with `[checkpoint]`, so Vercel doesn't build them; GitHub still runs the
   checks.
2. **"Show me":** a push without `[checkpoint]` builds a Vercel preview of the branch to open on a
   phone. Vercel deployments are limited, so previews happen only on request.
3. **"Launch":** the checks pass, any held migrations are applied to Supabase, the pull request is
   marked ready and merged into `main`, and Vercel deploys the live site. After a production
   deployment, `.github/workflows/post-deploy.yml` loads the landing page, the health endpoint and
   the sign-in page; on failure it opens an issue and prepares a revert pull request.

**Migrations and previews:** previews share the live database, and migrations run on the first
request to any deployment. So a new migration stays out of preview pushes and is added at launch;
a preview of work that needs a new table won't fully work until then.

**Builds:** `scripts/vercel-ignore.sh` skips the Vercel build for a commit that only touches
`docs/`, `.claude/`, `.github/`, `CLAUDE.md`, `README.md`, `PRODUCT.md`, `DESIGN.md` or
`THIRD_PARTY_NOTICES.md`, and, off `main`, for a commit whose first line contains `[checkpoint]`.
`main` otherwise always builds.

**Automation on Vercel:** there is no always-on process. Due automation runs at the end of each
state-changing request and in a daily cron (`/api/cron/tick`); recurring visits are generated then
and whenever a plan is created or resumed.

## Stack

| Layer | Choice |
|---|---|
| Web interface | React 19, React Router 7, TanStack Query, Vite, plain CSS with semantic tokens, Lucide icons, self-hosted Geist + Geist Mono |
| API | Hono on Node.js 22 (TypeScript), zod validation |
| Auth | Own sessions: random 256-bit tokens (stored as SHA-256), httpOnly SameSite=Lax cookies, bcrypt (cost 12) password hashes, CSRF header check |
| Database | PostgreSQL 16+ through `pg`; with no `DATABASE_URL`, an embedded PostgreSQL (PGlite) stored in `./data/db` |
| Migrations | Ordered SQL files in `migrations/`, applied automatically under an advisory lock |
| Files | Local disk (`./data/uploads`) or database storage (`STORAGE_DRIVER=database`; used on Vercel) |
| Background work | Durable `events → automation_runs → actions → approvals` tables; an in-process worker locally; request-time draining plus a daily cron on Vercel |
| Tests | Vitest (API and domain, against PGlite or PostgreSQL) and Playwright browser checks |

Code layout (area by area in `docs/CODEMAP.md`):

```
src/shared/     business rules shared by server and client (permissions, pricing math, job states,
                workflow definitions/validation/simulation, schedules, branding contrast)
src/server/     http/ (app, auth context, errors) · modules/ (one router per area) ·
                automation/ (engine + action primitives) · adapters/ (email, AI, storage, capabilities) · db/
src/client/     components/ (UI kit, shell) · pages/ · lib/ (api, session, offline drafts, theme)
migrations/     SQL schema (schema "rigo")
test/           API and domain tests
e2e/run.mjs     browser checks (themes, widths, accessibility, real flows)
```

## The docs, in reading order

1. `CLAUDE.md`: how Claude works on Rigo (read automatically every session).
2. `README.md`: this file.
3. `PRODUCT.md`: where Rigo is going, and the owner's decisions.
4. `docs/FEATURES.md`: what works today, area by area, and the gap to the vision.
5. `docs/CODEMAP.md`: where each area lives in the code, with its tests and tables.
6. `DESIGN.md`: how Rigo looks, and which design skill to use for each kind of look request.
