# Features

What Rigo does today, area by area (the same areas as `docs/CODEMAP.md`). The vision is in
`PRODUCT.md`; this file is what actually exists. A redesign keeps everything marked Working.

**Status:** Working (covered by an automated test or browser check) · Built (built and used, no
dedicated test yet) · Simulated (deliberately simulated) · Not built.
`[Template]` marks features only the field-service template (fuel delivery, portable toilets,
septic) uses. "(labeled Driver)" and similar notes mark general features that still use
field-service words.

Latest full run (October 2026, before the docs rebuild): 261/261 API and domain tests on embedded
PostgreSQL and on PostgreSQL 16; 94/94 browser checks; typecheck clean. Every pull request runs the
suite on GitHub.

## Gap to PRODUCT.md

| Vision goal | Today |
|---|---|
| Any business, not only field service | Not built: services, job states and words assume field service |
| Rename everything (custom vocabulary) | Not built: words are fixed (English and Spanish) |
| Add, rename and remove roles | Built in part: four fixed roles; owners edit each role's permissions |
| Owner-built stages with meaning tags | Not built: job states are fixed (draft, open, in progress, completed, partial, unsuccessful, cancelled) |
| One work record renamed per workspace | Not built: the work record is a "job" |
| Customer request forms and booking pages | Not built |
| Owner decides how failed or partial work is handled | Not built: unsuccessful is never billed, partial is held (fixed rules) |
| Automation levels per workspace, workflow, step and person or role | Built in part: workspace, workflow and step; not per person or role; the most specific setting applies |
| Money, deleting and first runs need a person by default | Built in part: invoice issue needs approval in the standard workflows; deleting and first runs have no default approval |
| One-tap approval from a phone notification | Not built: approvals are decided in the inbox |
| Assistant sets up a whole workspace | Not built: it answers questions and proposes workflows |
| Template library: publish a workspace | Working: "Publish a blank copy" shares structure only; stages and vocabulary aren't part of it yet |
| Pick a template or start empty | Built in part: setup starts from the field-service services |
| Demo of any template with a "Show sample data" button | Not built: one field-service demo with sample data always on |
| Workspaces customize the look freely | Built in part: logo and accent colour only |
| Native App Store and Google Play apps | Not built: web app, installable from the browser |

## accounts
- Accounts, sessions and password hashing (bcrypt, hashed session tokens, httpOnly cookies). Working.
  `accounts.test.ts`
- Signing in or up lands on the right page the first time, from any entry point; signed-in people
  skip the sign-in forms; signing out forgets everything cached on the device. Working. Browser check
- Sign-in limits with a progressive pause from the 5th failure. Working. `accounts.test.ts`
- Client address for those limits, trusted only behind Vercel or `RIGO_TRUST_PROXY`. Built.
- Password rule ("three or four unrelated words", common passwords refused). Working.
  `accounts.test.ts`
- Password reset by email; reset links say "already used", "expired" or "doesn't work". Working.
- Recovery without email: owner-created single-use reset links from Team; the recovery page says
  what works before anyone types. Working. `accounts.test.ts`, browser check
- Email typo suggestions at sign-up. Working.
- Email confirmation (in the test inbox; on the live site only once an email service is set). Working.
- Change email; delete account (except the last owner of a company). Working. Browser check
- Plain-language validation messages and tab titles. Working.
- Confirm your email before inviting or emailing customers, once email can be sent. Working.

## workspace-setup
- Create a company, belong to several, with a different role in each. Working. `access.test.ts`,
  browser check
- Several owners; the last active owner can't be removed or demoted. Working. `access.test.ts`
- Resumable setup with a readiness checklist; not ready until every service has rates; business
  hours mark after-hours visits. Working. `setup-phase3.test.ts`
- Settings: company, invoice settings, custom fields, connected services. Built.
- Branding: logo and accent colour with readable light and dark variants, live preview on the
  company chip, invoice header and message. Working (contrast) · Built (upload and preview).
- Templates: system, private, shared and public; applying shows a plan, skips what exists, adds
  workflows as drafts, never people; later template edits never change a company. Working.
  `expansion.test.ts`
- "Publish a blank copy": structure only, labeled "Made by another Rigo user", can be unpublished.
  Working.

## people-and-roles
- Role presets Owner, Dispatcher, Driver and Office/billing; owners edit each role's permissions
  (records, fields, actions, money, workflows, approvals, members). Built.
- Permissions checked on the server; one company never sees another's data (non-members get 404).
  Working. `access.test.ts`, `operations.test.ts`
- Rates, contact details and amounts removed on the server for roles without access. Working.
  `field-filtering.test.ts`
- Invitations bound to an email: single use, expiry, revoke, replace, wrong-account guidance,
  concurrent accept; each says how it went out; re-inviting asks first. Working. `access.test.ts`,
  `team-phase2.test.ts`, browser check
- Invitation email preview when no email service is set. Working.
- Activity log (owners only): who did what and when, in plain words, filtered. Working.
- Delegated approval authority for a period. Working. `approvals-automation.test.ts`

## customers
- Customers, locations and custom fields. Working. `customers-phase2.test.ts`
- Duplicate warnings, merge (with undo), archive and delete. Working. `customers-phase2.test.ts`,
  browser check
- Customer picker: search by name, phone or address, keyboard friendly. Working. Browser check
- Customer page: next visit and, for finance roles, what they owe. Working. `customers-phase2.test.ts`,
  browser check
- Search ignores accents and phone formatting; an exact job number opens the job. Working.
- Billing contact separate from the main contact. Working.
- Someone else pays for a job (bill-to customer); inspection report. Working.
  `customers-phase2.test.ts`, browser check
- Lists load 50 customers at a time and search on the server. Working. `navigation-phase3.test.ts`
- CSV imports with mapping, review, duplicates and ambiguity, confirm; Windows/Excel files keep
  their accents. Working. `expansion.test.ts`, `imports-phase3.test.ts`, browser check
- Spreadsheet (XLSX) imports. Not built (people are asked to save as CSV).

## services-and-pricing
- Services with fields, price lines, tax and photo or signature requirements. Built.
- Price lines that depend on a field value; a choice with no matching line holds the invoice. Working.
  `domain.test.ts`
- Customer tax exemption and customer-specific prices. Working. `pricing.test.ts`
- Service editor: a live example bill and warnings for unusual prices. Working. Browser check
- Price changes are dated; an invoice shows the price on the day and any change since booking.
  Working. `pricing.test.ts`
- [Template] Rates to a hundredth of a cent ($3.8995/gal). Working. `pricing.test.ts`
- [Template] Included quantity with overage ("Pump-out includes 1,000 gal") and minimum charges.
  Working.
- Configurable multi-section forms. Not built.

## work-items
- Jobs (labeled Job), with drafts that explain what's missing; a duplicate submission is ignored.
  Working. `operations.test.ts`, browser check
- Priority: Normal, Urgent, Emergency; emergencies alert owner and dispatch at once. Working.
  `dispatch-approvals.test.ts`
- Late jobs flagged. Working. `dispatch-approvals.test.ts`, browser check
- Partial and unsuccessful outcomes kept apart from completed work. Working.
- Problem reporting; corrections keep history, rebuild draft invoices and cancel stale approvals.
  Built.
- Photos and signatures (file type checked, size limited). Built.
- Reschedule an unsuccessful or partial visit as one follow-up job. Working. `polish-phase3.test.ts`
- Edit conflicts: "Keep mine" / "Use theirs"; leaving with unsaved changes asks first. Working.
- Rescheduling keeps the job's length. Working. `rentals.test.ts`, browser check
- Job report (text email with a photo count; printable page in Rigo). Built.
- Jobs list loads 100 at a time and searches on the server. Working. `navigation-phase3.test.ts`

## schedule
- Live timeline on Home and Jobs: a lane per worker (labeled Driver), an Unassigned lane, the
  moving "now" line, a side panel to assign, and a feed view. Working. Browser check
- Busy days: blocks lead with the customer, a 4-hour zoom, "Now" and "Later hours" cues. Working.
  Browser check
- Assign from the jobs table or the timeline panel, with Undo; bulk assignment. Working. Browser check
- Assignment conflicts and stale edits refused; "Assign anyway" recorded in history. Working.
  `operations.test.ts`
- Equipment (labeled Trucks & equipment) with an out-of-service guard that lists affected jobs.
  Working. `dispatch-phase2.test.ts`, browser check
- Workers told in plain words when their job changes. Working.
- Home "Needs you" ranked by urgency in three tiers, each row with its own action. Working. Browser
  check
- Command menu (Ctrl/⌘ K): screens, jobs, customers, invoices and quick actions, filtered by
  permission. Working. Browser check
- Times in the company's time zone with friendly zone names. Working.
- Configurable dashboard widgets. Not built (the Home order is fixed).
- Drag to reassign on the timeline. Not built (a select in the side panel).

## worker-app
- Today / Upcoming / Finished on the phone (labeled My jobs); one primary action at a time ("Start
  job", then "Submit to office"). Working. Browser check
- Record the outcome, quantities, notes, photos and signature; completion is idempotent and a stale
  record becomes a conflict. Working. `operations.test.ts`, browser check
- Works offline: opens from the saved copy, saves drafts and sends them when back online; sign-out
  with unsent drafts asks first. Working. `drafts.test.ts`, browser check
- Records that arrive after the job moved on are kept for the office to review. Working.
  `driver-records.test.ts`, browser check
- Reassigning or removing someone mid-job; hand-over to another worker; shared phones. Working.
- "On my way" with an optional arrival estimate. Working.
- Payment collected at the stop, confirmed later by the office. Working.
- Installable from the browser (manifest, icons, service worker). Built.
- In Spanish (driver screens, sign-in, invitations, notifications, customer messages). Working,
  needs review by a Spanish speaker. `language-phase3.test.ts`, browser check
- [Template] Several fuel products or tanks at one stop, each at its own price and tax. Working.
  `fuel-phase2.test.ts`, browser check
- [Template] Meter readings, ticket numbers, tanks and a price index on delivery lines; a mismatch
  holds the invoice. Working.
- [Template] Quantity checks against the truck's capacity and the requested amount. Working.

## invoicing
- Invoices built from confirmed work with exact totals (tax, discounts, rounding). Working.
  `domain.test.ts`
- A missing price holds the invoice, never charges 0. Working. `operations.test.ts`,
  `domain.test.ts`
- One invoice per billable event; void and re-bill links the replacement. Working.
- Approve, issue, number, void and record payments. Working. `billing-lifecycle.test.ts`
- Discounts (percent or fixed; "Make this invoice free" on purpose). Working.
- Due dates from terms; paid, credited and balance due on the invoice. Working.
- Snapshots: issuing keeps the customer, addresses and service as they were. Working.
- One payment status everywhere (Unpaid, Partly paid, Paid, Overdue N days, Void). Working.
- Payments, customer credit, refunds and credit notes. Working.
- Manual invoices, deposits, and sending a draft for approval. Working.
- Held invoices say per reason whether they need a check or a fix; "Reviewed: release hold". Working.
  `fuel-phase2.test.ts`
- Invoice email with lines and totals, and a view link (random, hashed, expires in 60 days, revoked
  on void). Working.
- Invoices grouped by work state with separate invoice, approval, delivery, payment and total cells.
  Working. Browser check
- Branded invoice preview and print / save as PDF. Built. Browser check
- Approvals can't be skipped from the invoice page. Working. `security-review.test.ts`

## payments
- Collections: amounts owed by age and per customer, customer credit, payments to confirm. Working.
- Reminders prepared before and after the due date; customer statements. Working.
- Invoice, reminder and statement messages only for people who see billing. Working.
  `privacy-phase3.test.ts`
- Processing card or bank payments. Not built (payments received are recorded).

## recurring-billing
- Recurring service with a visit schedule separate from billing; idempotent, pausable, changeable,
  missed visits detected. Working. `expansion.test.ts`, `rentals.test.ts`
- Billing every 4 weeks (28 days) or every N days. Working. `domain.test.ts`, `expansion.test.ts`
- Plan defaults: a default worker and truck so visits arrive assigned. Working.
- Restart catch-up for recurring work and automation. Built.
- [Template] Rental plans with unit lines (standard, ADA, hand-wash), billed every 4 weeks,
  monthly, weekly or per event; delivery, pickup and extra-visit prices. Working.
- [Template] Routine visits covered by the rent are not billed again. Working.
- [Template] Pause and early end prorate the rent by the day; credits are never counted twice.
  Working. `money-review.test.ts`

## automation
- Modes Manual / Assisted / Automatic for the company, with per-workflow and per-step overrides and
  per-workflow pause. Working (modes) · Built (overrides). `operations.test.ts`
- Automatic never bypasses approvals; approvals are bound to the record and workflow version.
  Working. `approvals-automation.test.ts`, `operations.test.ts`
- Company pause (hold or cancel queued work), resume and take over; the pause shows on every page.
  Working. `operations.test.ts`, browser check
- Workflows versioned Draft → Tested → Active, with validation and a plain-language explanation.
  Working. `domain.test.ts`
- Test with sample data in each mode; dry run. Working. Browser check
- Visual builder and form view on the same draft. Working. Browser check
- Standard workflows on from the start; the invoice issue step needs Owner or Office approval.
  Working.
- Conditions include price changed since booking, tax exempt, customer type, partial visit and
  quantity over capacity. Working.
- Bounded retries, idempotent actions, limits on loops and fan-out. Built.
- "Prepare customer update" and triggers for "on the way" and "starts a job". Working.

## approvals-inbox
- Who can approve: the validator refuses approvers who can't approve. Working.
- Linked approvals; approval cards show what is approved, with the total. Working.
  `dispatch-approvals.test.ts`, browser check
- Escalation never approves; backups and owners are notified. Built.
- Notifications: the bell and an inbox (needs action, warnings, updates); unread is not resolved;
  counts match what is shown. Working. `dispatch-approvals.test.ts`

## messages
- Messages with honest states (Prepared, Simulated, Sent, Replied), linked to customers, jobs and
  invoices. Built.
- Email (Resend or Postmark) and texts (Twilio), off until their keys are set and the company is
  allowed to send. Working. `providers-phase3.test.ts`
- Until then: messages stay Prepared, Send is off with the reason, and people can copy and mark
  "sent outside Rigo". Working.
- Test inbox at `/dev/mailbox` on a local copy. Working.
- Customer emails are plain text; the branded layout is the in-app preview. Built.

## assistant
- Answers from the company's data (a customer's next visit and balance, who is free, a service's
  price for people who see billing, why an approval isn't yours). Working. `assistant-phase3.test.ts`
- Proposals from plain words through a rule-based builder, kept separate from active workflows.
  Working.
- "Ask Rigo" chips on held invoices and blocked or failed steps. Built.
- Real AI (Anthropic) behind a switch, real companies only, with a daily limit. Simulated (off by
  default; prepared answers labeled).

## demo-and-landing
- Public landing page for signed-out visitors. Working. Browser check
- A demo company per visitor, with reset and "View as" role switching. Working. `expansion.test.ts`,
  `dispatch-approvals.test.ts`, browser check
- Guided walkthrough from the driver view to the simulated invoice email; phone demo bar. Working.
  Browser check
- The demo makes no outside calls; "Set up my company" copies structure only. Working.
  `expansion.test.ts`
- [Template] The demo shows a fuel, portable toilet and septic business. Working.

## foundation
- Runs locally with no database server (embedded PostgreSQL); PostgreSQL 16+ with migrations under
  a lock. Working.
- CSRF protection. Working. `access.test.ts`
- Design tokens in three layers, light, dark and system themes. Working.
- Responsive shell: grouped sidebar that collapses, bottom navigation on phones. Working. Browser
  check
- Menus grouped by work, unknown addresses show "page not found", denied pages name the permission.
  Working. Browser check
- Plain words: a browser check reads 22 pages for machine words. Working. Browser check
- Accessibility: no serious problems on 22 pages, 200% text, reduced motion, keyboard only.
  Working. Browser check
- Each screen loads its own script; a loading screen while the app starts. Working.
- Change system: PR check on GitHub, post-deploy check that opens an issue and prepares a revert,
  docs-only changes skip Vercel builds, migration and push guards. Built.

## Known limitations
- Background automation on Vercel runs during requests and once a day; a quiet company may wait
  until the next request or the cron.
- Rate limiting and the in-process worker are single-instance designs.
- Screen-reader walkthroughs and offline tests on a real phone are still to do.
- Motion: a job moving to another lane appears without a transition; table rows don't animate.
- The timeline feed lists jobs only, not messages or automation steps.
- Spanish needs review by a Spanish speaker; office screens are English; server notifications use
  the language chosen in Account.
- The workflow builder's preview of "Send prepared message" talks about email even for a text.
- A send happens inside the database transaction that records it; a database failure right after a
  provider accepted it would show it as still prepared.
- Templates published before the Phase 3 template fixes lose their workflows in the public copy
  until the owner refreshes the template from the company.
- Owner-created reset links rely on trust in the company's managers.
- Without email, a mistyped address can be fixed only while signed in.
- Priority doesn't change automation yet; whether it should is the owner's decision.
- The walkthrough follows demo job #3; deleting it means resetting the demo.
- Self-approval: the Office preset can edit, approve and issue the same invoice; requiring a second
  person is the owner's decision.
- Pending invitation links are stored until used, revoked, replaced or expired.
- [Template] Corrections after the fact edit the job's values, not its delivery lines; tank products
  are free text.
- The job report email carries a photo count, not the photos.
- Customer search matches text; misspellings are caught only when adding a customer.

**Simulated or off until set up:** account and customer email, texts, real AI, payment processing,
maps and routing (only "Open in Maps" links), subscription billing.

**Waiting on the owner:** email keys (`RIGO_EMAIL_PROVIDER`, `RIGO_EMAIL_API_KEY`,
`RIGO_EMAIL_FROM`), text keys (`RIGO_SMS_PROVIDER`, `TWILIO_*`), `RIGO_SENDING_COMPANIES`,
`RIGO_SUPPORT_EMAIL`, terms and privacy URLs, an Anthropic key for real AI, and the GitHub Actions
setting that lets the post-deploy check open revert pull requests.
