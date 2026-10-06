# Implementation status

Legend: **Verified** = implemented and covered by an automated test (`test/*.test.ts` API/domain
tests, `e2e/run.mjs` browser checks). **Implemented** = built and exercised manually or indirectly,
not yet covered by a dedicated test. **Simulated** = deliberately simulated. **Deferred** = not
built yet. **Blocked** = needs a specific external dependency.

Deployment: the Vercel preview of this branch connects to Supabase through the transaction pooler
(`aws-0-us-east-1`, role `rigo_app`); the migration created 40 tables in schema `rigo`, which the
public API roles cannot access.

Latest results (local, Round 1 account fixes): `npm test` 63/63 passed on embedded PostgreSQL
(PGlite) and 63/63 on PostgreSQL 16; `e2e/run.mjs` 51/51 browser checks passed against a local
copy with the simulated mailbox plus a production-like copy with no email service
(`NOEMAIL_URL`); axe found no violations on the 18 app pages and on the landing, sign-in, sign-up,
forgot, reset, workspaces and account pages and the Team reset-link dialog, in light and dark
themes; `npm run typecheck` clean.

## A. Foundation

| Item | Status | Evidence / notes |
|---|---|---|
| Local setup without a database server | Verified | PGlite in `./data/db`; tests run in memory |
| PostgreSQL support and migrations | Verified | Suite passes on PostgreSQL 16; advisory-locked SQL migrations |
| Accounts, sessions, password hashing | Verified | bcrypt cost 12; hashed session tokens; httpOnly cookies |
| CSRF protection | Verified | Custom-header requirement (`access.test.ts`) |
| Signing in or up lands on the right page the first time, from any entry point | Verified | Fixed a stale "signed out" cache (Round 1, C1). Browser checks from `/`, sign-up, bookmarks and a driver's `/c/…/today` link, at 1440 and 390px |
| Signing out forgets everything cached on the device | Verified | Browser check: a second person signing in on the same tab sees none of the first person's data |
| Signed-in people skip the sign-in and sign-up forms | Verified | Browser check; they go to `?next=` (same-site paths only) or Workspaces |
| Sign-in limits | Verified | Only failed sign-ins count, keyed by email + device address (10 per 15 minutes), plus 100 failures per address across accounts. Success, reset and password change clear them. The message names the wait (`Retry-After` too) and links to reset; the last 3 tries are counted. Old records are cleaned daily. `accounts.test.ts`, browser check |
| Client address for limits | Implemented | `X-Forwarded-For` is trusted only on Vercel (which overwrites it) or with `RIGO_TRUST_PROXY=1`; otherwise the connection address |
| Password rule | Verified | `src/shared/password.ts`: 10+ characters; rejects the 10,000 most common passwords (server-side list), repeated characters, sequences and keyboard rows, and the person's name or email. Applied at sign-up, reset and change; existing accounts keep working. `accounts.test.ts` |
| Password reset by email | Verified | Through the account email boundary (`sendSystemEmail`): the simulated mailbox locally; not available on the live site until an email service is chosen. The reset page checks the link first and signs the person in afterwards |
| Recovery without email: owner-created reset links | Verified | Team → "Reset link" (needs `members.manage`; only owners for an owner; never for yourself). Single use, 24 hours, audited, other owners notified, shown once. Re-checked when used: the person must still belong to the company, the creator must still be allowed, and anyone who also belongs to or is invited to another company is refused. Demo: simulated, no real link. `accounts.test.ts`, browser checks |
| Recovery page says what works before anyone types | Verified | `GET /api/auth/recovery`; without email it shows the owner-link path and, if `RIGO_SUPPORT_EMAIL` is set, a support address. Browser check on the no-email copy |
| Email typo suggestions | Verified | Sign-up and change email suggest fixes for common domain typos (gmial.com → gmail.com); never blocks |
| Email confirmation | Verified (mailbox) · Not available on the live site | Link sent at sign-up and on request; single use, 7 days. Optional: nothing is blocked on it. Hidden where email can't be sent |
| Change email | Verified | Needs the current password; refuses an address in use. With email: confirmed by a link to the new address, the old address is told. Without email: changes at once. Other devices are signed out; invitations to the new address appear. Browser walkthrough on both copies |
| Delete account | Verified | Needs the password; refused while you are the only owner of a company. Memberships end (open jobs return to the queue), the demo is deleted, sessions and links are revoked, and the row is anonymized so company history stays intact |
| Plain-language validation messages | Verified | A global zod error map (`src/server/lib/zod-messages.ts`); a test checks no message uses developer wording. Inputs carry `maxLength` matching the server limits |
| Tab titles | Verified | "Page · Company · Rigo" (with "(Demo)" in the demo) |
| Company isolation and 404 for non-members | Verified | `access.test.ts` |
| Role model and server-side permissions | Verified | Driver/office/owner checks in `operations.test.ts` |
| Field-level filtering (rates, contact, amounts) | Verified | Driver gets no rates; amounts removed without `finance.view` |
| Design tokens (primitive → semantic → component), both themes, System theme | Verified | axe light+dark; theme persisted to account + device |
| "Light command center" UI: black chrome, Geist / Geist Mono, every screen restyled | Verified | axe on 18 pages, overflow at 4 widths and 200% text; before/after screenshots in the pull request |
| Responsive shell (grouped sidebar / bottom nav ≤5 / More) | Verified | Overflow checks at 4 widths; nav count check |
| Public landing page at `/` for signed-out visitors | Verified | Names the three industries, what it does for office, drivers and owners, "Free to start", what isn't connected yet, and real demo screenshots (WebP, both themes, regenerated by `scripts/landing-shots.mjs`). Browser checks: content, redirect when signed in, "Try the demo" opens the demo after sign-up, axe in both themes, no overflow at 4 widths and 200% text |
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
| Account email (password reset, invitations, email confirmation and change) | All of it goes through `sendSystemEmail`. Locally: the simulated mailbox at `/dev/mailbox`. On the live site (no provider yet): invitations give the inviter a copyable link, password recovery uses owner-created reset links, email changes apply at once, and confirmation isn't offered. |
| AI | Off by default; prepared responses clearly labeled. Anthropic adapter exists behind `RIGO_AI_PROVIDER=anthropic` + key, real companies only, daily limit. Not exercised against the live API in tests. |
| Payments | Not processed. Payments received can be recorded. |
| Maps, routing, geocoding | Not connected. Addresses are text; "Copy address" on the driver screen. |
| Subscription billing | Not part of this build. Creating companies is free. |

## Blocked / needs owner action

| Item | Dependency |
|---|---|
| Real email delivery | Choose an email service, then add its adapter to `PROVIDERS` in `src/server/adapters/index.ts` (keyed by `RIGO_EMAIL_PROVIDER`). Reset, invitation, confirmation and email-change emails all start working at once. |
| Support address for owners with no other owner | Set `RIGO_SUPPORT_EMAIL` (not set: the forgot page leaves that line out). |
| Terms of service and privacy policy | Publish them and set `RIGO_TERMS_URL` and `RIGO_PRIVACY_URL` (not set: no agreement line at sign-up). |
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
- Owner-created reset links rely on trust in the company's managers: whoever holds the link can
  set the person's password until it is used or expires. Rigo refuses them for anyone who also
  belongs to or is invited to another company, notifies the other owners, and signs the person
  out elsewhere when it's used.
- Without an email service, a mistyped address can be fixed only while signed in (Account →
  Change your email). Someone who can't sign in needs an owner's reset link first.
- Next: email provider adapter, configurable dashboard widgets and job stages, XLSX import,
  map links/geocoding adapter (disabled by default), per-field permissions beyond contact/finance.
