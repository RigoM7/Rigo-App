# PR #8: Rebuild Rigo as a new application

https://github.com/RigoM7/Rigo-App/pull/8 · state: closed · merged: 2026-10-06T10:49:02Z

Replaces the previous app with a new, from-scratch Rigo: a configurable business management and automation platform for field-service companies (fuel delivery, portable toilets, septic).

## What's in it
- **Stack:** React 19 + Vite web app (installable PWA), Hono API on Node 22, PostgreSQL (`schema rigo`) with SQL migrations; embedded PGlite when no `DATABASE_URL` so it runs locally with no setup.
- **Accounts & companies:** personal accounts with no implicit access; multiple companies and owners, different roles per company, last-owner protection, email-bound single-use invitations (expiry, revoke, replace, wrong-account guidance, race-safe acceptance).
- **Permissions on the server:** role presets (Owner, Dispatcher, Driver, Office/billing) plus an editable permission matrix; financial and contact fields are removed from responses, not hidden.
- **Operations:** resumable setup and readiness checklist; customers and locations; trucks; service definitions with fields and pricing; jobs (drafts with missing-info explanation, assignment conflicts, stale-edit and duplicate protection); phone-first driver completion with offline drafts and explicit sync and conflict states; partial and unsuccessful visits handled separately; corrections keep history.
- **Billing:** deterministic invoice math in minor units. A missing rate holds the invoice instead of pricing it at zero. One invoice per billable event. Draft, approval, issue, delivery and payment are tracked separately, with a branded preview and print/save as PDF.
- **Automation:** Manual, Assisted or Automatic mode, with per-workflow and per-step overrides. Workflows are versioned (Draft → Tested → Active), validated, explained in plain language and tested on sample data, editable in a visual builder or a form view.
  - Approvals are tied to the exact record and workflow version, support delegation and escalation, and are never approved by a timeout.
  - Every step re-checks pause, permissions and versions when it runs; retries and loops are bounded.
  - Owners can pause the whole company or one workflow, resume, and take over a run.
- **Expansion:** reviewed CSV imports; templates (private/shared/public, applied as drafts); recurring service and rentals with separate billing schedules; communications states; company branding with accessible accent variants; assistant with labeled prepared responses and a disabled-by-default AI provider boundary.
- **Demo:** one fictional company per visitor, isolated and resettable, with a guided walkthrough and simulated role switching. "Set up my company" copies only the demo's structure, never its records. The server blocks all external calls from demo companies.
- **Docs:** `README.md`, `docs/PRODUCT-VISION.md`, `docs/DESIGN-SYSTEM.md`, `docs/UI-GUI-PROMPT.md`, `docs/IMPLEMENTATION-STATUS.md` (verified / implemented / simulated / deferred / blocked ledger).

## Deployment
- `npm run build` on Vercel writes Build Output v3 (static app + one Node function); `vercel.json` updated.
- Vercel env `DATABASE_URL` (production + preview) uses the Supabase transaction pooler (`aws-0-us-east-1`) with a new dedicated `rigo_app` login that only owns schema `rigo`. Migrations run on first request. The old `public.rigo_*` tables are untouched and unused.
- **Verified on the preview deployment:** the API connects to Supabase and the migration created 40 tables in `rigo`, which Supabase's public API roles cannot access.

## Verification
- `npm run typecheck` clean.
- `npm test`: 37/37 passing on embedded PostgreSQL and 37/37 on PostgreSQL 16. Covers isolation, invitations, last owner, field permissions, demo safety (no `fetch` calls), structure-only conversion, job conflicts and idempotency, missing prices, unsuccessful visits, approvals in Automatic mode, stale approvals, pause and takeover, recurring billing, imports, templates and the assistant.
- `e2e/run.mjs`: 24/24 browser checks, including real UI flows, axe WCAG 2.2 AA with 0 violations on 17 pages in light and dark, no overflow at 375/768/1024/1440 px and at 200% text, reduced motion, and the skip link.
- The bundled Vercel function was exercised against PostgreSQL 16, including running automation inside a request.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Xp2EqZUToyNw5BBzm2xeTX
