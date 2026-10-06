# Implementation status

Legend: **Verified** = implemented and covered by an automated test (`test/*.test.ts` API/domain
tests, `e2e/run.mjs` browser checks). **Implemented** = built and exercised manually or indirectly,
not yet covered by a dedicated test. **Simulated** = deliberately simulated. **Deferred** = not
built yet. **Blocked** = needs a specific external dependency.

Deployment: the Vercel preview of this branch connects to Supabase through the transaction pooler
(`aws-0-us-east-1`, role `rigo_app`); the migration created 40 tables in schema `rigo`, which the
public API roles cannot access.

Latest results (local, Phase 1 of the critique fixes: money, approvals and lost work): `npm test`
158/158 passed on embedded PostgreSQL (PGlite) and 158/158 on PostgreSQL 16; `e2e/run.mjs` 79/79
browser checks passed against a local build with the simulated mailbox (the copy without email,
`NOEMAIL_URL`, was not run this time), including the 18 Phase 1 checks (example bills, void and
re-bill, collections at 1366 and 390 px, a manual invoice and its view link, approval
confirmations, rental plan forms, the driver's phone at 360×640, 375×667 and 390×844 and at 200%
text, an offline save that survives closing the app and sends once on reconnect, a removed
driver's late record and the phone wipe, reassignment mid-job, Switch driver and the installed-app
start page); axe found no violations on the 19 screens scanned in these checks; `npm run typecheck`
clean. Reviews before shipping: isolation and field filtering, money, and security; every finding
is fixed with a test except self-approval, which is an owner decision (see Known limitations).

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
| Field-level filtering (rates, contact, amounts) | Verified | Driver gets no rates; amounts removed without `finance.view`. Phase 1 review: booked prices on jobs, check photos (job files and held records), invoice emails, reminders and statements in Messages (shown as "states amounts"), a workflow dry run's real invoice total, plan credits and tax rates are also removed without `finance.view`; message addresses without `customers.contact`. `field-filtering.test.ts` |
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
| Invitations and roles (WP7: R4-M1, R4-M2, R4-m2…m8, R9-m3, R12-m1) | Verified | Re-inviting an email with a pending invitation asks ("…already has a pending invitation as Dispatcher. Replace it with Driver?"); each invitation says how it went out ("Link created — not emailed (email not set up)", "Emailed", test mailbox); "Copy link" gives the same link again (the link works only for the invited address and is cleared once used, revoked or replaced; migration `013_team.sql`); "Text the link from this phone" opens the phone's messages app (no text provider); up to 25 invitations at once with a result per address. Role changes say what the person gains and loses; making or removing an owner needs "OWNER" typed. Permissions are listed by their plain names. A page a role doesn't include says so ("Your role doesn't include this page"). Signing up from an invitation fills in and fixes the invited address and joins without another click; after sign-in, someone in exactly one real company goes straight to it (drivers to My jobs). Drivers don't see "setup in progress" and get a dismissible "How a job works" guide on their first visit. Someone removed while a page is open sees "You no longer have access to Tri-County". `team-phase2.test.ts`, browser check |
| Activity log (R12-m2) | Verified | Settings → Activity (owners only, enforced by the server): who did what and when, in plain words, filtered by people and roles, invoices and payments, settings, automation, or jobs and trucks, with "Show older". Cancelled jobs and branding changes are now recorded too |
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
| Driver completion: idempotent, stale → conflict | Verified | `operations.test.ts`, browser check. On a conflict the office gets a needs-action item ("Luis has a record for job #88 that conflicts with an edit") and the driver's "Review what changed" lists each changed detail with the old value struck through (R13-m2) |
| Records that arrive after the job moved on (R9-M2, R12-M1, R4-m1, D12) | Verified | A record from a driver who was assigned the job, but no longer is (reassigned, handed over, or the job already finished), is kept as a pending review with its values and photos instead of "Job was not found": dispatch gets a needs-action item and "Driver records to review" (Jobs → records, and on Home) to accept it (the outcome is recorded as if sent in time, history says it was accepted late; for a finished job it joins the history without replacing the outcome) or dismiss it with a note the driver sees. A removed driver's phone is told "no longer a member" (only that person sees it), sends what it holds to `/api/late-records` (accepted for 7 days after removal, only for jobs they were assigned, rate-limited), then deletes that company's data from the phone. Migration `010_driver_records.sql`. `driver-records.test.ts`; browser checks for the race and the removed driver |
| Reassigning or removing someone mid-job | Verified | Taking a started job from its driver asks first ("Luis Driver has already started job #12"; `confirmStarted`), in the job page and the jobs table. Removing a member warns about jobs in progress and records they may still send |
| Hand-over and shared phones (R4-M4) | Verified | The assigned driver can "Give this job to another driver" (status kept, both told, history shows who handed it to whom), optionally leaving what they recorded on the phone for the next driver. Account → "Switch driver" signs out and keeps unsent records on the phone under their owner only; plain sign-out with unsent records offers that or "Discard records and sign out" |
| Partial and unsuccessful outcomes handled separately | Verified | Unsuccessful not billed; partial invoice held |
| Problem reporting, corrections with history | Implemented | Corrections rebuild draft invoices and invalidate approvals |
| Photos and signatures (type-sniffed, size-limited) | Implemented | |
| Invoices from confirmed data, deterministic totals | Verified | `domain.test.ts` (rounding, tax, discounts) |
| Price lines that depend on a field value | Verified | `when: { field, equals }` on a price line, for choice-list and yes/no fields (validated). Only matching lines are charged; a choice with no matching line holds the invoice ("No price for product 'Heating oil'"); the line names the choice. Editor: "Charge only when Product is Diesel". Fuel example: one per-gallon line per product; septic: per service detail; an "After-hours visit" fee on fuel and septic. `domain.test.ts` (per product, hold, 187.4 gal × $3.89 = $728.99, taxable + non-taxable) |
| Rates to the hundredth of a cent (D3) | Verified | Rates are stored in ten-thousandths (`rateE4`; $3.8995/gal is 38995); the editor, invoice line editor and customer prices accept up to 4 decimals; each line is quantity × rate rounded half up to the cent. Migration `004` converts existing rates and invoice lines and keeps writing whole-cent `rateMinor` / `rate_minor` alongside, so the version still in production reads the same data. `pricing.test.ts` |
| Real price lists: one product per job, included quantity with overage, minimum charge (R3-C1, R3-M1, R6-M2) | Verified | Flat lines can include a quantity ("Pump-out (includes 1,000 gal)") with a rate beyond it on a second line; per-unit lines can have a minimum ("Minimum charge $200.00 applies (150 gal × $0.95 = $142.50)"). Starters: fuel has one line per product plus a delivery fee; septic has pump-out, inspection, grease trap and repair visit. Unit test for every combination in the Tri-County price list (`test/fixtures/tricounty.ts`); editing other invoice lines keeps a minimum, changing that line recomputes it |
| Service editor: example bill and price warnings (R3-M2, R3-m3, R10-m3) | Verified | A live "Example bill" built with the invoicing code shows which lines a sample job pays, what isn't charged and why it would be held; warnings for several per-unit lines charging on every job, $0 and implausible rates, an included quantity without an overage rate, and a tax rate with no taxable line. "Make all lines taxable"; new lines start taxable when the service has a tax rate (also on invoices). Browser checks at 1366 and 390 px with axe |
| Customer tax exemption and customer prices | Verified | Tax exempt flag and certificate note beat the service's tax; prices per customer replace the service rate line by line. Only `invoices.edit` sets the exemption, only `finance.view` + `invoices.edit` see or set prices (removed on the server otherwise); unknown services and lines are dropped. `pricing.test.ts` |
| Quantity sanity on the driver's form (R7-M2, R7-m3) | Verified | Numbers are checked as the driver types ("Delivered quantity must be a number of zero or more"). More than the assigned truck holds (capacity read from "3,000 gal") or 3× the requested quantity must be typed again; the server enforces the same check (`quantityChecks` in `src/shared/billing.ts`) and holds the invoice: "Check the quantity before approving: …". The confirmation travels with the offline draft |
| Price at delivery, price changes shown (D4, R7-M3) | Verified | Each rate change is dated; invoice lines carry the price date ("price on Oct 6") and, when the rate differs from the one at booking, "Price changed since booking: $3.899 → $4.09" for the office (not printed for the customer). `pricing.test.ts` |
| Approval cards show what is approved | Verified | `GET /approvals` adds a summary from the stored invoice (total, tax, up to 5 lines, customer, job, service, hold reasons, "Delivered 187.4 gal of 200 requested"); amounts only with `finance.view`, removed on the server. The button says "Approve and issue · $773.99"; "View invoice" is read-only, "Edit invoice" is separate. Same totals on Home ("Invoices waiting for your approval"), the invoice page's button and the Decided tab; job and message approvals show their key facts. `dispatch-approvals.test.ts`, browser check (card total = invoice page total) |
| Inbox counts match what is shown | Verified | "Needs action" counts open action notices plus the approvals this person, in their current (simulated) role, may decide; Home uses the same rule. `dispatch-approvals.test.ts` per simulated role |
| Invoice email content | Verified | Lines ("Gasoline: 187.4 gal × $3.89 = $728.99"), tax, total, due date and Settings → "How customers pay you". States stay honest (prepared, simulated, sent). A customer-facing invoice link or PDF needs an email provider (owner decision) |
| Missing price → hold, never zero | Verified | `operations.test.ts`, `domain.test.ts` |
| One invoice per billable event | Verified | Duplicate preparation returns the same invoice |
| Approve / issue / number / void / payments | Verified | Approving on the invoice page asks for confirmation with the total. Numbers use the company prefix and continue from a set next number that only moves forward (D17). Payments idempotent by key. `billing-lifecycle.test.ts` |
| Void and re-bill (R10-C1) | Verified | A voided invoice stops billing the job: "Prepare new invoice" on the job or the voided invoice creates one that says "Replaces INV-00003", linked both ways; preparing again returns the same one, so a job is never billed twice. Customer credit used on the voided invoice goes back to the customer; its view link stops working |
| Discounts (R10-M1) | Verified | Percent and fixed discount lines, worked out in shared code; discounts larger than the charges are refused unless the person chooses "Make this invoice free", which trims them so the printed lines add up to $0 |
| Due date, balance and invoice settings (R10-M2, R3-m7, D18) | Verified | Due date set at issue from the customer's terms or the company's (net 30 by default); invoices show paid, credited and balance due, terms, payment instructions, remit-to address and tax ID; quantities print in a "Service record", and the driver's notes when the service opts in (R6-m3). Settings → Invoices |
| Snapshots (R10-M4, R5-M3) | Verified | Issuing stores the customer name, billing and service address and service; jobs keep the address they were booked for (set by a database trigger); editing a location changes future jobs only, with "Also update the N open jobs" (their drivers are told) |
| One payment status (R6-m1) | Verified | `paymentState` in `src/shared/invoices.ts`: Not issued, Unpaid, Partly paid, Paid, Overdue N days, Void; the same on the invoice, job, customer and list pages |
| Payments, credit, refunds, credit notes (R6-m2, R10-m2, R10-m4, D6) | Verified | Dated payments (backdating allowed, not the future), balance prefilled; anything over the balance becomes customer credit, used automatically when the next invoice is issued; owners reject a payment with a reason (it stops counting, its credit is reversed, history kept); refunds reopen the balance; credit notes take off the balance; Void explains "Refund them first" while paid; times in the company time zone |
| Payment at the stop (D21) | Verified | The driver records check (number required, optional photo), cash or card on a separate terminal; it waits as "Not confirmed" until the office confirms it in Collections or on the invoice, then pays the job's invoice once issued; one per submission, never billed twice |
| Manual invoices, deposits, sending for approval (R8-M3, R6-M3, D22) | Verified | "New invoice" for a customer and optional site with custom lines and tax rate; deposits and prepayments become customer credit; a draft can be sent for approval, which asks everyone who may approve invoices and issues it when approved. The event-rental deposit at booking is part of WP4 |
| Collections (R10-M3, D19, D20) | Verified | Collections page: amounts owed by age (not yet due, 1–30, 31–60, over 60 days) and per customer, customer credit, payments collected at stops to confirm; reminders prepared 3 days before due and at 7 and 30 days overdue, sent only after someone presses "Approve and send" (or skipped); statements per customer (printable, emailed only through a provider) and prepared automatically on the 1st for customers marked "monthly statement". Runs hourly and on the cron tick |
| Invoice email and view link (R2-m9, R15-m4) | Verified | The prepared email has the lines, total, paid, balance, due date, how to pay and a link to view or print the invoice. The link is random, stored only as a hash, expires after 60 days and is revoked on void; it shows only that invoice, without internal notes. Never sent without a provider ("Prepared, not sent") |
| Branded invoice preview, print/save PDF | Implemented | Browser screenshot; PDF via the browser's print |
| Live dispatch timeline on Home and Jobs (driver lanes, Unassigned lane, now line, job side panel, feed view) | Verified | Browser check: lanes, now line, side panel with assignment, feed view in the URL; axe on both views |
| Bulk driver assignment from the jobs table | Verified | Uses the same per-job assignment endpoint; jobs that can't move are summed up in one line ("3 jobs not changed: they overlap other work") with "View list" (R11-m4) |
| Trucks out of service (R11-M1, R3-m2) | Verified | Marking a truck out of service or retired while open jobs use it lists those jobs and asks first; dispatch gets a needs-action item and "Jobs on an out-of-service truck" on Home, linking to the filtered jobs list, where "Swap truck" replaces it on the selected jobs (each job checked for clashes; the drivers are told). A truck already on a job can stay while the driver changes; only adding one is refused. An "out of service until" date returns it to Available. Names are unique per company; trucks never used can be deleted. Migration `012_dispatch.sql`. `dispatch-phase2.test.ts`, browser check |
| Drivers told what changed (R11-M2, R6-M1) | Verified | Edits to the time, address, access, site contact, notes, priority or truck of an assigned job tell the driver in plain words ("Job #54 changed: Moved from 6:00 AM to 9:00 AM", "New access instructions: …"); today's and tomorrow's are needs-action. The phone shows a "Changed" banner and tag until the driver taps "Got it"; a new assignment is tagged "New" until opened; cancellations and reassignments say "don't go". Push or text are not used (no provider) |
| Emergencies (R6-M1, D15) | Verified | An emergency job alerts the owner and dispatch at once (needs-action, "No driver yet. Assign one now."), and its driver as soon as one is assigned; "Emergency jobs not finished" on Home; on the phone emergencies are listed first, in their own section, with a bordered "Emergency" tag (not colour alone) |
| Busy-day timeline (R11-M3) | Verified | Blocks lead with the customer's name (up to two lines), then time and number; never narrower than about 12 characters, and rows are packed by that width; "4 hours" zoom; "Now" button and a "Later hours" cue; overlapping jobs without a driver fold into "+N more"; out-of-service trucks and emergencies marked on blocks; the feed can be grouped by driver. Browser checks with 6 drivers and 9–15 jobs each at 1440 and 1024 px |
| Edit conflicts and unsaved changes (R11-m1, R11-m2) | Verified | When someone else saves a job first, the editor keeps what was typed, takes their changes to fields left alone, and lists fields both changed with "Keep mine" / "Use theirs". Leaving with unsaved changes asks first on the job, service, workflow, new plan and settings forms (one guard per page; switching settings tabs asks too). Customer and location dialogs: see WP8 |
| Assign anyway, cancelling in progress, truck picker, maps (R11-m4, R11-m3, R11-m5, R9-M3) | Verified | An overlap can be accepted deliberately ("Assign anyway"), recorded in history; cancelling a job in progress warns that the driver may be on site and work done won't be billed; the truck picker lists the trucks for the job's kind of work first ("Used for" on each truck), with "Show all"; the driver's job has "Open in Maps" (Apple Maps on iPhone, Google Maps elsewhere; a link, no key) and My jobs has "Today's stops in order" |
| Invoices grouped by work state; separate invoice / approval / delivery / payment / total cells | Verified | Overdue tab and group; due date and balance columns; rental invoices show their billing period (R10-m1). Browser checks: print view shows only the document, collections at 1366 and 390 px, a manual invoice through the customer's view link |
| "Ask Rigo" chips (held invoices, blocked or failed steps) open the Assistant with a prefilled question | Implemented | |
| Branding live preview (switcher chip, invoice header, message) | Implemented | |
| Automation modes Manual/Assisted/Automatic | Verified | `operations.test.ts` |
| Automatic never bypasses approvals | Verified | The company rule "Every invoice needs approval before issuing" is in Settings → Invoices (owner only, confirmed, audited). When it applies to an issue step without its own approval, Rigo creates a normal approval request for everyone who can approve invoices instead of a blocked step (R14-M1). Turned off, Automatic issues on its own. `approvals-automation.test.ts` |
| Approvals bound to record + workflow version; stale on edit | Verified | `operations.test.ts` |
| Company pause (hold/cancel), resume, takeover | Verified | `operations.test.ts` |
| Escalation never approves; backups/owners notified | Implemented | Worker tick |
| Who can approve (R14-C1, D7, R4-M3) | Verified | The validator refuses a step whose chosen approvers can't approve (Approve invoices covers invoice steps; Decide approvals covers all) and warns about roles and backups that can't; the editor marks roles "can't approve" and only offers people who can. Owners can always decide, recorded as "Owner override". The Office / billing preset approves invoices and decides approvals (migration `008` for unchanged Office roles). Owners are told at once when a role or member change leaves a pending approval with nobody who can decide it |
| Linked approvals | Verified | Approving on the invoice page decides the workflow's waiting approval; issuing directly settles the waiting issue step and the run continues to the email; voiding stops the run |
| Delegated approval authority | Verified | Only people whose role can approve are offered (with an explanation when nobody is); the delegate is told in their bell and the delegator's approvals appear in their inbox. `approvals-automation.test.ts` |
| Bounded retries, idempotent actions, loop/fan-out limits | Implemented | Depth ≤3, ≤10 runs/event, ≤300 actions/hour/company |
| Notifications: bell, inbox (needs action / warnings / updates), unread ≠ resolved | Verified | The bell separates Needs action from Updates and folds several "joined the company" into one line; titles name the job, customer or invoice, and assignment notices say when ("You have a new assignment: Job #12 for Grace Okafor, Tue, Oct 7, 9:00 AM") (R14-m5). Approving from an approval card asks first, with the total |

## C. Configurability

| Item | Status | Evidence / notes |
|---|---|---|
| Versioned workflow definitions (Draft → Tested → Active) | Verified | Edit after test creates new draft; activation requires test |
| Validation and plain-language explanation | Verified | `domain.test.ts` |
| Sample-data testing per mode | Verified | Browser check |
| Visual builder + form view on the same draft | Verified | Browser check (both views) |
| Conversational proposals (rule-based guided builder) | Verified | Proposal stays separate until accepted |
| Per-workflow and per-step mode overrides; per-workflow pause | Implemented | Pausing or deactivating a workflow asks first and says what stops ("Completed jobs will no longer be billed automatically"); switching the company mode asks first with a plain summary (R14-m2, R18-m1). Clearing the assistant conversation and revoking an invitation ask first |
| Standard workflows on from the start (R3-M3) | Verified | New companies get the standard workflows active, acting for the owner who created the company; the invoice issue step needs approval by Owner or Office. Home shows "Completed jobs not yet billed (N)" whatever the workflows do (Jobs filter "Completed, not yet billed"); Automation shows "N of M workflows on". Setup's Continue saves the chosen mode (R3-M5) |
| Pause visible everywhere (R14-m4) | Verified | "Automation is paused by Dana since …" banner on every page for people who see automation, with Resume. Browser check |
| Workflow conditions and dry run (R14-m1, R14-m3) | Verified | Invoice amounts typed in dollars, stored in cents; new conditions: price changed since booking, customer tax exempt, customer type (a "Type" custom field), partial visit, quantity over the truck's capacity. The validator rejects conditions that can never all be true; the dry run uses the company's most recent job or invoice and can say "Would not start: in this sample, job priority is emergency is not true." |
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
| Recurring service and rentals: separate billing, idempotent, pause, change, missed visits | Verified | `expansion.test.ts`, `rentals.test.ts` |
| Rental credits by the day (Phase 1 review, D5) | Verified | Each issued rent invoice's credited days are kept, so a pause followed by an early end never credits a day twice; credits larger than the next rent invoice carry over instead of being lost; credits on a draft rent invoice survive a rebuild; resuming a pause bills again from today (credits for the days after today are taken back, and a period skipped while fully paused is billed for its active days). A rejected payment takes back credit it created that already paid other invoices (they are owed again), and a rejected deposit lowers the plan's received amount; money taken at a visit that isn't billed on its own goes to the customer's credit and pays their open invoices; statements use the company's calendar day. Migration `011_rent_credit_ledger.sql`. `money-review.test.ts` |
| Approvals can't be skipped (Phase 1 security review) | Verified | A workflow step never issues an invoice still waiting for approval; approving on the invoice page is refused while a workflow approval names someone else ("waiting for approval from Owner"); delegated authority ends when the delegator is removed or changes role, and a removed named approver no longer counts; held driver records are limited to one per person and job and 20 per person, rate-limited; every sign-out clears the phone's saved company data. `security-review.test.ts` |
| Rental visits covered by the rent (R8-C1) | Verified | Routine plan visits, and delivery and pickup without a plan price, are not billed again ("Covered by the plan"); an extra visit bills at the plan's extra price or the service pricing. The billing workflow ends quietly for covered visits; Home doesn't count them as unbilled |
| Rental pricing (R8-M1, R2-M4) | Verified | Plans hold several unit lines (standard, ADA, hand-wash) with their own quantity and rate per period; billed every 4 weeks (28 days), monthly, weekly or once for an event; prices for delivery, pickup and extra visits; an optional deposit, fixed or percent of one period, recorded as customer credit that pays the rent (D22). Rental units (PT-101…) are placed on site with a plan, back in the yard, or missing; one plan at a time. Older plans' single rate reads as one line |
| Pause and early end adjust the rent (R8-M2, D5) | Verified | Prorated by the day on the period's length: draft rent invoices are rebuilt with fewer days ("23 of 28 days: paused Oct 10 – Oct 14, 2026"), rent already issued is credited on the next rent invoice, and an early end credits the issued invoice (any excess becomes customer credit). The plan's banner says exactly this |
| Plan defaults (R7-m2, R8-m2, R8-m5, R8-m1, R8-m3, R8-m4) | Verified | No weekday pre-ticked; a default driver and truck per plan, so visits arrive assigned (and the driver is told); Units shows only where it applies; one units field on the portable toilet starter, prefilled on the driver's form; a dispatcher creating a rental is told billing sets the rates and billing gets a needs-action item; plain dates, and paused dates left out of "Coming visits"; ending a plan offers "Create the pickup job"; "Move event" moves delivery, pickup and visits together |
| Rescheduling keeps the length (R8-M4, R6-m7) | Verified | Moving a start moves the end by the same amount, on the server (job edit and assignment) and in the job form and assignment panel. `rentals.test.ts`, browser check |
| Rental billing every 4 weeks (28 days), or every N days | Verified | `billingPeriods('every_n_days', …, everyDays)`: calendar periods from the plan start in the company time zone; no doubled invoices on re-run; whole paused periods skipped. `domain.test.ts`, `expansion.test.ts` (month end, daylight-saving change, company-zone date boundary, pause) |
| Demo shows a fuel, portable toilet and septic business | Verified | Diesel/Gasoline/Heating oil prices; Lakeview rental billed every 28 days with its first invoice; an emergency after-hours septic pump-out with a priced, issued invoice; a paid heating oil delivery; one deliberately held invoice (septic inspection without a rate); urgent job #3; no status text in seeded notes. "Set up my company" still copies structure only, prices empty |
| Restart catch-up for recurring/automation | Implemented | Worker runs on start; durable tables |
| Driver app offline (R13-C1, R13-M1, R13-m1, R13-m3, R13-m4) | Verified | The last sign-in check and a driver's company settings are kept on the phone (IndexedDB, per user and company, removed on sign-out), so with no signal the app opens My jobs and the job pages from the saved copy; other pages say "This page needs a connection"; back online it checks again straight away. Submitted records send automatically on start, when signal returns, when the app comes to the front, and on a 15 s → 1 min → 5 min backoff, one at a time, with one summary toast. States: "Waiting for signal — will send automatically" (info), "Not sent yet — will try again" with the server's reason, "Needs your review", "With the office for review", "Sent to the office". After an offline submit the buttons give way to a saved state with "Edit record". Busy labels ("Starting…", "Sending…"). The installed app opens `/open` (straight to the only company, or the last one) and uses one theme colour. Browser check with a persistent phone profile: save offline, close, reopen offline (jobs and record there), reconnect, exactly one completion |
| Driver job screen (R9-M1, R9-m1, R9-m4, R6-m4, R6-m5) | Verified | The sticky bar's one primary action is "Start job", then "Submit to office"; no outcome is preselected; a record sent without starting is accepted and history marks the start as implicit; starting another day's job asks ("This job is for tomorrow. Start anyway?"); could-not-complete has quick reasons (Locked gate, Dog, No access, Customer cancelled on site, Tank full, Other) and replaces the notes field; photo labels read "(at least 1 required)" or "(optional)"; an unreadable photo says so; the customer can type their name instead of drawing, with a confirmation box, recorded as typed. Browser checks at 360×640, 375×667 and 390×844 and at 200% text |
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
- Screen-reader walkthroughs (VoiceOver/TalkBack) and offline testing on a real phone (the automated check uses Chromium's offline mode) still to do.
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
- Self-approval: the Office preset can edit, approve and issue invoices, so one person can approve
  an invoice they changed. Owners can always approve. Requiring a second person is an owner
  decision; a workflow step that names its approver (for example the owner over $5,000) can't be
  skipped by approving on the invoice page (`security-review.test.ts`).
- Next: email provider adapter (the invoice view link is built; sending it needs the provider), configurable dashboard widgets and job stages, XLSX import,
  map links/geocoding adapter (disabled by default), per-field permissions beyond contact/finance.
