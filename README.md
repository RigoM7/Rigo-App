# Rigo

Rigo is a configurable business management and automation platform for field-service
companies, starting with fuel delivery, portable toilet rentals and servicing, and septic
services. Owners create a company workspace, invite their team, configure services and
workflows, and choose how much Rigo automates, while staying in control of approvals,
pauses and takeovers.

- Product: [docs/PRODUCT-VISION.md](docs/PRODUCT-VISION.md)
- Design system: [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)
- Reusable UI/GUI prompt: [docs/UI-GUI-PROMPT.md](docs/UI-GUI-PROMPT.md)
- What is built, verified, simulated or deferred: [docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md)

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

Code layout:

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
Locally, invitation, password-reset and email-confirmation emails are not sent: they appear in
the **simulated mailbox** at `/dev/mailbox`. Set `APP_URL=http://localhost:8787` when using
`npm start`, or the emailed links point to the dev server on port 5173.

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
| `RIGO_EMAIL_PROVIDER` | Account email service for password reset, invitation and email confirmation emails. No provider is implemented yet, so recovery uses owner-created reset links. |
| `RIGO_TRUST_PROXY` | `1` trusts `X-Forwarded-For` for client addresses (sign-in limits). Automatic on Vercel, which overwrites the header. |

## Tests

```bash
npm run typecheck
npm test                                   # API/domain tests on embedded PostgreSQL (PGlite)
DATABASE_URL=postgres://… npm test         # the same tests on a real PostgreSQL server

# Browser checks against a running server (uses the pre-installed Chromium):
npm run build && npm start &
BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) npm run test:browser
# Add NOEMAIL_URL=http://localhost:8788 (the production-like copy above) to also check recovery
# without email; E2E_ONLY=auth runs only the account and sign-in checks, E2E_ONLY=round2 only
# the demo walkthrough, assignment, approval-card and demo-content checks, E2E_ONLY=phase1 only
# the money, approvals, rentals and driver-app checks (offline phone, removed driver, hand-over).
```

The browser checks run real flows (the landing page, sign-in and sign-up from any entry point,
lockout warnings, password recovery by mailbox and by an owner's reset link, email change,
demo and its guided walkthrough from the driver view to the simulated invoice email, live
timeline and job panel, command menu, sidebar collapse, dispatch (save on change, Undo, stale
tabs, keyboard, unsaved-changes warning), driver completion, approval cards with the invoice
total, per-product fuel pricing, 28-day rental billing, late and urgent jobs,
workflow edit/test, assistant proposal, company creation, employee invitation, example bills,
void and re-bill, collections, discounts and view links, approval confirmations, rental plans,
the driver's phone at 360–390 px, offline save and reopen with automatic sending, a removed
driver's late record, reassignment mid-job and shared-phone sign-out), an axe
WCAG 2.2 AA scan of 18 app pages plus the landing, sign-in, sign-up, forgot, reset,
workspaces and account pages and the Team reset-link dialog in light and dark themes,
horizontal-overflow checks at 375,
768, 1024 and 1440 px (in every simulated demo role), 200% text, reduced motion and keyboard skip link. Screenshots go to
`e2e/output/`.

## Deploying (Vercel + Supabase)

`npm run build` on Vercel also writes `.vercel/output` (Build Output API v3): the web app
as static files and the API as a single Node.js function (`scripts/vercel-output.mjs`).
Required environment variable: `DATABASE_URL` (Supabase transaction pooler, port 6543, using
the dedicated `rigo_app` role, which owns only the `rigo` schema). Migrations run on the first
request. `APP_URL` sets the production link base. Commits to branches other than `main`
whose first line contains `[checkpoint]` skip Vercel builds.

On Vercel there is no always-on process: due automation runs at the end of each
state-changing request and in a daily cron (`/api/cron/tick`); recurring visits are generated
then and whenever a plan is created or resumed.
