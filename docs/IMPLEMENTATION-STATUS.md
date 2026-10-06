# Implementation status

Legend: **Verified** = implemented and covered by an automated test (`test/*.test.ts` API/domain
tests, `e2e/run.mjs` browser checks). **Implemented** = built and exercised manually or indirectly,
not yet covered by a dedicated test. **Simulated** = deliberately simulated. **Deferred** = not
built yet. **Blocked** = needs a specific external dependency.

Deployment: the Vercel preview of this branch connects to Supabase through the transaction pooler
(`aws-0-us-east-1`, role `rigo_app`); the migration created 40 tables in schema `rigo`, which the
public API roles cannot access.

Latest results (local, "Light command center" redesign): `npm test` 37/37 passed on embedded
PostgreSQL (PGlite); `e2e/run.mjs` 27/27 browser checks passed; axe found 0 violations on 18
pages in light and dark themes; `npm run typecheck` clean. The redesign changed only the web
client, so the PostgreSQL 16 run was not repeated (it last passed 37/37 before the redesign).

## A. Foundation

| Item | Status | Evidence / notes |
|---|---|---|
| Local setup without a database server | Verified | PGlite in `./data/db`; tests run in memory |
| PostgreSQL support and migrations | Verified | Suite passes on PostgreSQL 16; advisory-locked SQL migrations |
| Accounts, sessions, password hashing | Verified | bcrypt cost 12; hashed session tokens; httpOnly cookies |
| CSRF protection | Verified | Custom-header requirement (`access.test.ts`) |
| Sign-in rate limiting | Implemented | Per email/IP window in the database |
| Password reset | Implemented | Simulated mailbox locally; honest "not configured" in production |
| Company isolation and 404 for non-members | Verified | `access.test.ts` |
| Role model and server-side permissions | Verified | Driver/office/owner checks in `operations.test.ts` |
| Field-level filtering (rates, contact, amounts) | Verified | Driver gets no rates; amounts removed without `finance.view` |
| Design tokens (primitive → semantic → component), both themes, System theme | Verified | axe light+dark; theme persisted to account + device |
| "Light command center" UI: black chrome, Geist / Geist Mono, every screen restyled | Verified | axe on 18 pages, overflow at 4 widths and 200% text; before/after screenshots in the pull request |
| Responsive shell (grouped sidebar / bottom nav ≤5 / More) | Verified | Overflow checks at 4 widths; nav count check |
| Sidebar collapses to icons and remembers it | Verified | Browser check |
| Command menu (Ctrl/⌘ K): screens, jobs, customers, invoices, quick actions | Verified | Browser check finds job #3 and opens it; results filtered by permission, server checks again |

## B. First operational product

| Item | Status | Evidence / notes |
|---|---|---|
| Create company, multiple companies, roles per company | Verified | `access.test.ts`, browser check |
| Multiple owners; last-owner protection | Verified | `access.test.ts` |
| Invitations: email-bound, single use, expiry, revoke, replace, wrong account, concurrent accept | Verified | `access.test.ts`; employee flow in browser |
| Simulated invitation email preview | Verified | Mailbox test; preview shown to inviter |
| Resumable setup + readiness checklist | Implemented | Browser check creates a company and sees the checklist |
| Demo per visitor, reset, role simulation | Verified | `expansion.test.ts` |
| Demo makes no external calls | Verified | `fetch` spy in `expansion.test.ts`; enforced in `adapters/` |
| Demo → real company copies structure only | Verified | `expansion.test.ts` |
| Customers, locations, custom fields | Implemented | Used in tests; custom-field validation via shared rules |
| Trucks/equipment, out-of-service guard | Implemented | |
| Jobs: drafts with missing-info explanation | Verified | `operations.test.ts`, browser check |
| Duplicate job submission guard | Verified | Same `clientRequestId` returns the same job |
| Assignment conflicts, stale edits | Verified | `operations.test.ts` |
| Driver completion: idempotent, stale → conflict, reassigned → refused | Verified | `operations.test.ts`, browser check |
| Partial and unsuccessful outcomes handled separately | Verified | Unsuccessful not billed; partial invoice held |
| Problem reporting, corrections with history | Implemented | Corrections rebuild draft invoices and invalidate approvals |
| Photos and signatures (type-sniffed, size-limited) | Implemented | |
| Invoices from confirmed data, deterministic totals | Verified | `domain.test.ts` (rounding, tax, discounts) |
| Missing price → hold, never zero | Verified | `operations.test.ts`, `domain.test.ts` |
| One invoice per billable event | Verified | Duplicate preparation returns the same invoice |
| Approve / issue / number / void / payments | Verified (approve/issue) · Implemented (void, payments) | Payments idempotent by key |
| Branded invoice preview, print/save PDF | Implemented | Browser screenshot; PDF via the browser's print |
| Live dispatch timeline on Home and Jobs (driver lanes, Unassigned lane, now line, job side panel, feed view) | Verified | Browser check: lanes, now line, side panel with assignment, feed view in the URL; axe on both views |
| Bulk driver assignment from the jobs table | Implemented | Uses the same per-job assignment endpoint, so conflicts are refused per job and reported |
| Invoices grouped by work state; separate invoice / approval / delivery / payment / total cells | Implemented | Browser check opens an invoice |
| "Ask Rigo" chips (held invoices, blocked or failed steps) open the Assistant with a prefilled question | Implemented | |
| Branding live preview (switcher chip, invoice header, message) | Implemented | |
| Automation modes Manual/Assisted/Automatic | Verified | `operations.test.ts` |
| Automatic never bypasses approvals | Verified | Company-wide invoice approval rule also enforced |
| Approvals bound to record + workflow version; stale on edit | Verified | `operations.test.ts` |
| Company pause (hold/cancel), resume, takeover | Verified | `operations.test.ts` |
| Escalation never approves; backups/owners notified | Implemented | Worker tick |
| Delegated approval authority | Implemented | |
| Bounded retries, idempotent actions, loop/fan-out limits | Implemented | Depth ≤3, ≤10 runs/event, ≤300 actions/hour/company |
| Notifications: bell, inbox (needs action / warnings / updates), unread ≠ resolved | Implemented | Browser approves from inbox |

## C. Configurability

| Item | Status | Evidence / notes |
|---|---|---|
| Versioned workflow definitions (Draft → Tested → Active) | Verified | Edit after test creates new draft; activation requires test |
| Validation and plain-language explanation | Verified | `domain.test.ts` |
| Sample-data testing per mode | Verified | Browser check |
| Visual builder + form view on the same draft | Verified | Browser check (both views) |
| Conversational proposals (rule-based guided builder) | Verified | Proposal stays separate until accepted |
| Per-workflow and per-step mode overrides; per-workflow pause | Implemented | |
| Service definitions: fields, stages, pricing, tax, photo/signature | Implemented | Price change rebuilds held invoices (verified) |
| Custom fields for customers/locations/jobs | Implemented | Job custom fields captured at creation |
| Role permission matrix (owner-editable) | Implemented | |
| Configurable dashboard widgets | Deferred | Dashboard order is fixed per the brief |
| Configurable job stages / multi-section forms | Deferred | Statuses are fixed; fields are configurable per service |

## D. Expansion

| Item | Status | Evidence / notes |
|---|---|---|
| CSV imports with mapping, review, duplicates, ambiguity, confirm | Verified | `expansion.test.ts` |
| Spreadsheet (XLSX) imports | Deferred | Users are told to save as CSV |
| Templates: system, private, shared, public; apply as drafts; no upstream drift | Verified | `expansion.test.ts` |
| Recurring service and rentals: separate billing, idempotent, pause, change, missed visits | Verified (generation, billing, pause) · Implemented (change, end) | `expansion.test.ts` |
| Restart catch-up for recurring/automation | Implemented | Worker runs on start; durable tables |
| Offline driver drafts (IndexedDB, per user+company), sync states, conflicts | Verified (UI states, server reconciliation) | Full airplane-mode test not automated |
| Sign-out with unsynced drafts handled deliberately | Implemented | Account page offers sync or discard |
| PWA install (manifest, icons, service worker) | Implemented | Browser installability not automated |
| Company branding: logo, accessible accent variants | Verified (contrast) · Implemented (upload) | |
| Communications model and states | Implemented | Prepared/simulated/sent-outside-Rigo/replied |

## Simulated or disabled by design

| Capability | Behavior |
|---|---|
| Customer email/SMS delivery | No provider implemented. Real companies: messages stay **Prepared** and the send step is **Blocked** with an explanation; people can copy and mark "sent outside Rigo". Demo: **Simulated**. |
| System email (invitations, resets) | Local simulated mailbox at `/dev/mailbox`. In production the inviter gets a copyable link; password reset reports that email is not configured. |
| AI | Off by default; prepared responses clearly labeled. Anthropic adapter exists behind `RIGO_AI_PROVIDER=anthropic` + key, real companies only, daily limit. Not exercised against the live API in tests. |
| Payments | Not processed. Payments received can be recorded. |
| Maps, routing, geocoding | Not connected. Addresses are text; "Copy address" on the driver screen. |
| Subscription billing | Not part of this build. Creating companies is free. |

## Blocked / needs owner action

| Item | Dependency |
|---|---|
| Real email delivery | Choose and configure a provider (e.g. an SMTP/API service), then implement its adapter in `src/server/adapters/index.ts`. |
| Real AI answers | An Anthropic API key in `ANTHROPIC_API_KEY` with `RIGO_AI_PROVIDER=anthropic`. |

## Known limitations and next steps

- Background automation on Vercel runs during requests and once a day by cron; a busy company
  sees immediate progress, a quiet one may wait until the next request or cron. A dedicated worker
  (or more frequent cron on a paid plan) would remove this.
- Rate limiting and the in-process worker are single-instance designs; scaling out needs a shared
  queue/lock (the database locks already prevent double execution).
- Screen-reader walkthroughs (VoiceOver/TalkBack) and real-device offline testing still to do.
- Motion: timeline blocks slide when a job's time changes, but a job moving to another driver's
  lane appears there without a transition, and table rows do not animate on status changes.
- The timeline reassigns by select in the job side panel; drag-to-reassign is not built.
- The timeline feed lists the day's jobs; it does not yet interleave other events (messages,
  automation steps).
- Customer emails are plain text (no email provider yet); the branded layout is the in-app
  preview in Messages.
- Next: email provider adapter, configurable dashboard widgets and job stages, XLSX import,
  map links/geocoding adapter (disabled by default), per-field permissions beyond contact/finance.
