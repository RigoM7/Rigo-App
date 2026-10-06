# Implementation status

Legend: **Verified** = implemented and covered by an automated test (`test/*.test.ts` API/domain
tests, `e2e/run.mjs` browser checks). **Implemented** = built and exercised manually or indirectly,
not yet covered by a dedicated test. **Simulated** = deliberately simulated. **Deferred** = not
built yet. **Blocked** = needs a specific external dependency.

Deployment: the Vercel preview of this branch connects to Supabase through the transaction pooler
(`aws-0-us-east-1`, role `rigo_app`); the migration created 40 tables in schema `rigo`, which the
public API roles cannot access.

Latest results (local, Round 2 demo fixes): `npm test` 80/80 passed on embedded PostgreSQL
(PGlite) and 80/80 on PostgreSQL 16; `e2e/run.mjs` 64/64 browser checks passed against a local
copy with the simulated mailbox plus a production-like copy with no email service
(`NOEMAIL_URL`), including the 13 new Round 2 checks (walkthrough from the driver view, assignment,
approval cards, demo content, phone demo bar, overflow in every simulated role at 375/768/1024/1440
and at 200% text); axe found no violations on the 18 app pages, the landing and account pages, and
the Round 2 screens (demo home with the walkthrough, jobs table, inbox with approval cards, service
editor, recurring plan form, job form) in light and dark themes; `npm run typecheck` clean.

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
| Times shown in the company's time zone, with friendly zone names | Verified | Every in-company date and time uses the company zone (the jobs table's "updated" time included). Time zones show as "Central Time (Chicago)"; the picker adds the device's zone when it is missing |

## B. First operational product

| Item | Status | Evidence / notes |
|---|---|---|
| Create company, multiple companies, roles per company | Verified | `access.test.ts`, browser check |
| Multiple owners; last-owner protection | Verified | `access.test.ts` |
| Invitations: email-bound, single use, expiry, revoke, replace, wrong account, concurrent accept | Verified | `access.test.ts`; employee flow in browser |
| Simulated invitation email preview | Verified | Mailbox test; preview shown to inviter |
| Resumable setup + readiness checklist | Implemented | Browser check creates a company and sees the checklist |
| Demo per visitor, reset, role simulation | Verified | `expansion.test.ts`. Reset keeps the same company id, so saved demo links keep working; opening the demo again (Workspaces "Open my demo" or `/start-demo`) starts in the Owner view (`dispatch-approvals.test.ts`, browser check) |
| Guided demo walkthrough | Verified | Seven steps ("Step x of 7"), each with the simulated role it needs and the control it points at. "Show me" switches role, opens the page, scrolls to the control and outlines it (dashed token outline with a text label, outside the control and its focus ring; still when reduced motion is on). Wrong role or missing prerequisite: one plain sentence and one button. Steps show "Done" from the records (boot `demo.progress`, no polling). Collapses to one line; hidden walkthrough resumes from the demo bar. Browser checks: whole walkthrough from the driver view to the Simulated email, blocked step, phone layout |
| Phone demo bar | Verified | Keeps "Fictional. Nothing is sent or charged.", a labeled Reset and "View as"; two rows; simulated-role pill moves out of the top bar on phones. Browser check: no overflow at 375px in every simulated role; demo bar + top bar + collapsed walkthrough under 30% of an 844px screen |
| Demo makes no external calls | Verified | `fetch` spy in `expansion.test.ts`; enforced in `adapters/` |
| Demo → real company copies structure only | Verified | `expansion.test.ts` |
| Customers, locations, custom fields | Implemented | Used in tests; custom-field validation via shared rules |
| Trucks/equipment, out-of-service guard | Implemented | |
| Jobs: drafts with missing-info explanation | Verified | `operations.test.ts`, browser check |
| Duplicate job submission guard | Verified | Same `clientRequestId` returns the same job |
| Assignment conflicts, stale edits | Verified | `operations.test.ts` |
| Assigning a driver from the jobs table or timeline panel | Verified | Saves when chosen (busy state on the row), toast with Undo (uses the new version). A refusal puts the menu back and shows the server's reason beside it. Keyboard arrowing waits until Enter, leaving the menu, or a pause, so it saves once. The job page's combined driver/truck/time form warns before leaving with unsaved changes (`useBlocker` + `beforeunload`). Browser checks: persists after navigation, Undo, stale second tab, keyboard, leave warning |
| Job priority (normal, urgent, emergency) | Verified | Migration `003_job_priority.sql`. Set in the job form; Urgent/Emergency pill (icon + text) on the timeline, table, board, job page and driver's phone; urgent first within a day (company time zone); filter; unassigned urgent jobs counted in "Needs you" with Assign; "Job priority" workflow condition. `dispatch-approvals.test.ts` (saved, filtered, sorted, driver sees it, driver cannot change it) |
| Late jobs | Verified | Rule in `src/shared/jobs.ts` (`isLate`: still open after its window ended; one hour when no end). "Late" pill on the timeline, table, board and job page; "Jobs running late" in "Needs you"; `?late=1` filter. `dispatch-approvals.test.ts`, browser check |
| Driver completion: idempotent, stale → conflict, reassigned → refused | Verified | `operations.test.ts`, browser check |
| Partial and unsuccessful outcomes handled separately | Verified | Unsuccessful not billed; partial invoice held |
| Problem reporting, corrections with history | Implemented | Corrections rebuild draft invoices and invalidate approvals |
| Photos and signatures (type-sniffed, size-limited) | Implemented | |
| Invoices from confirmed data, deterministic totals | Verified | `domain.test.ts` (rounding, tax, discounts) |
| Price lines that depend on a field value | Verified | `when: { field, equals }` on a price line, for choice-list and yes/no fields (validated). Only matching lines are charged; a choice with no matching line holds the invoice ("No price for product 'Heating oil'"); the line names the choice. Editor: "Charge only when Product is Diesel". Fuel example: one per-gallon line per product; septic: per service detail; an "After-hours visit" fee on fuel and septic. `domain.test.ts` (per product, hold, 187.4 gal × $3.89 = $728.99, taxable + non-taxable) |
| Approval cards show what is approved | Verified | `GET /approvals` adds a summary from the stored invoice (total, tax, up to 5 lines, customer, job, service, hold reasons, "Delivered 187.4 gal of 200 requested"); amounts only with `finance.view`, removed on the server. The button says "Approve and issue · $773.99"; "View invoice" is read-only, "Edit invoice" is separate. Same totals on Home ("Invoices waiting for your approval"), the invoice page's button and the Decided tab; job and message approvals show their key facts. `dispatch-approvals.test.ts`, browser check (card total = invoice page total) |
| Inbox counts match what is shown | Verified | "Needs action" counts open action notices plus the approvals this person, in their current (simulated) role, may decide; Home uses the same rule. `dispatch-approvals.test.ts` per simulated role |
| Invoice email content | Verified | Lines ("Gasoline: 187.4 gal × $3.89 = $728.99"), tax, total, due date and Settings → "How customers pay you". States stay honest (prepared, simulated, sent). A customer-facing invoice link or PDF needs an email provider (owner decision) |
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
| Rental billing every 4 weeks (28 days), or every N days | Verified | `billingPeriods('every_n_days', …, everyDays)`: calendar periods from the plan start in the company time zone; no doubled invoices on re-run; whole paused periods skipped. `domain.test.ts`, `expansion.test.ts` (month end, daylight-saving change, company-zone date boundary, pause) |
| Demo shows a fuel, portable toilet and septic business | Verified | Diesel/Gasoline/Heating oil prices; Lakeview rental billed every 28 days with its first invoice; an emergency after-hours septic pump-out with a priced, issued invoice; a paid heating oil delivery; one deliberately held invoice (septic inspection without a rate); urgent job #3; no status text in seeded notes. "Set up my company" still copies structure only, prices empty |
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
- Priority does not change automation yet (a workflow can test it as a condition); whether it
  should, for example never auto-approving an emergency invoice, is an owner decision.
- The walkthrough follows demo job #3; a visitor who deletes or cancels it can reset the demo.
- Next: email provider adapter, customer-facing invoice link or PDF (needs the provider), configurable dashboard widgets and job stages, XLSX import,
  map links/geocoding adapter (disabled by default), per-field permissions beyond contact/finance.
