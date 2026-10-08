# Rigo

What Rigo is, what it does today, what it doesn't yet, and the owner's decisions. A request that
conflicts with this file is flagged before it is built. How it looks is `DESIGN.md`; how to run and
ship it, and where the code is, is `README.md`.

## What Rigo is

One place where any business runs its work. A cleaner, a salon, a bakery or a fuel company creates
a workspace, sets it up in its own words, and Rigo takes on the routine: preparing invoices,
confirming bookings, reminding customers who owe. The owner decides how much Rigo does on its own.

## Rules for every workspace

1. **The owner decides how much is automated**, and stays in control through levels, approvals,
   pause and take-over. Nothing ever approves itself; a timeout never approves.
2. **Honest states.** Nothing claims a send, sync, payment, price or approval that didn't happen.
   Simulated and demo output is labelled.
3. **Workspaces start empty and private.** No sample data in a real workspace; each workspace's data
   is isolated and permission-checked on the server.
4. **Configuration, not code.** Owners set everything up in the app, as validated data.
5. **Exact money.** Prices, quantities, taxes and totals are exact; a missing price holds an invoice;
   AI never decides prices, taxes or totals.
6. **Works on the go.** Workers get focused phone screens, big controls and offline records; only the
   server's acceptance completes work.
7. **Every screen** has one main action, the most important thing first, and nothing the person
   can't use.

## What it does today

**Accounts.** Anyone can sign up. One account can own workspaces and work in others with a different
role in each. Sign-in pauses after repeated failures and names the wait; passwords follow one rule
(10+ characters, not common or personal). Recovery by email when an email service is set, otherwise
by a one-time reset link an owner makes. Email confirmation and change, account deletion (never
while the only owner), invitations by email or a link to share.

**Your words, roles and stages.** Each workspace names its main record (job, appointment, order,
visit…), its customers, its team, its equipment and its places, and every screen follows. Owners
build roles (office screens or the phone app) and tick what each may see and do; the Owner role
always exists; nobody but an owner gives a role that can do more than their own. Owners build the stages of the main record, each tagged Open, Active, Finished,
Cancelled or Failed; a stage can need a field filled first and can limit where work moves next.
Custom fields on work, customers and equipment (text, number, money, choice, yes/no, date, phone,
email); phone and email fields are removed for roles without contact access, money fields for roles
without money access.

**The first five minutes.** Create an account → name the workspace and describe it in a sentence
(or pick a type) → Rigo suggests the closest template by plain word matching and shows what it
brings → one review screen to adjust words, stages and roles → invite the team or skip → Today, with
a short setup checklist.

**Templates.** Field service (fuel, portable toilets, septic), cleaning and home services,
appointments (salon, grooming, tutoring), orders and delivery (bakery, catering, small shop), and a
general start. Structure only: never prices, people or records. Owners can publish their setup to a
shared library; anyone can start from a published template. Applying copies it.

**Work and schedule.** The main record with a customer, a place, a time, assigned people and
equipment, fields, notes, what it charges for, and history. A list, a board by stage, a month
calendar (an agenda on phones) and a day timeline with a lane per person or per piece of equipment.
Assigning uses selects and buttons, never dragging. Search on every screen.

**Customers.** Contacts, places with access notes, more people to reach, history. Each customer's
page leads with the next visit and what they owe. Duplicate warnings, archive and restore.

**The worker phone app.** Today, Upcoming and Done, only their own work. The address first, call
and directions buttons, one main action at the bottom (start, finish), "couldn't do it" when the
owner has such a stage, and the fields a stage needs. Works offline: lists are kept on the phone,
updates are saved there and send themselves when signal returns; the same update never applies twice.

**Money.** A price list (prices to a hundredth of a cent; a missing price is never zero). Invoices
built from finished work for one customer, with exact totals and tax; a missing price, quantity or
tax rate holds the invoice with the reason. Approve (by default every invoice needs a person's
approval), issue with a continuing number, void (it keeps its number), record payments received,
see what is owed by age (not yet due, 1–30, 31–60, over 60 days) and what is ready to bill.

**Automation, assisted.** Three automations: invoices from finished work, booking confirmations, and
reminders for invoices 7 days overdue. Each is Off, Manual, Assisted (the default: Rigo prepares, a
person approves) or Automatic; the workspace has a level too and the safest wins. Automatic on money
needs an owner's confirmation and still waits for approval while invoices require it. Pause stops
everything (held items run or are cancelled on resume); any item can be taken over. The inbox holds
what waits for a person: approvals, booking requests and held invoices, plus updates.

**Booking and request pages.** A public page per workspace: people ask for work, or pick a free time
from the owner's hours. Requests land in the inbox; accepting adds the customer (matched by email or
phone) and the work. Never shows prices or people; rate limited, with a bot trap.

**Demos.** Any template opens as a demo: empty at first, "Show sample data" fills it (customers,
work across stages, invoices Rigo prepared, a part-paid invoice, confirmations to approve). "See it as
a worker" shows the phone app. Demos never send, charge, connect or call a paid service.

**The front page.** The vision, the same screen in four businesses' words, a request becoming a
payment, the automation levels, templates, an honest list of what isn't connected, and sign-up.

## Not yet (the gap to the vision)

| Vision | Today |
|---|---|
| AI assistant: questions in plain words, setup by conversation | After launch. Suggestions use word matching. |
| Native App Store and Google Play apps | Installs from the browser. |
| Sending email and texts to customers | Prepared always; sent only once the owner connects a service (keys) and allows the workspace. |
| Taking card payments | Records payments received. |
| Workflows the owner builds (triggers, steps, approver per step, delegation) | Three built-in automations with levels. |
| Recurring work and rentals | Not rebuilt yet. |
| Photos, signatures and files on work | Not rebuilt yet. |
| Imports from files, customer merge | Not rebuilt yet. |
| A workspace's own look (logo, colour) | Not rebuilt yet. |
| Spanish | Not rebuilt yet; English only. |
| Several work record types per workspace | One main record per workspace. |

## Decisions

One line per decision, newest last.
- 2026-10-07: Rigo is a platform for any business; field service becomes one template.
- 2026-10-07: Migrations wait for launch and stay out of preview pushes, because previews share the
  live database.
- 2026-10-07: Only launching (merging into `main`) needs the owner's approval.
- 2026-10-07: Email (Resend or Postmark) and texts (Twilio) stay off until the owner sets their keys;
  until then recovery uses owner-created reset links.
- 2026-10-07: Rebuild everything from scratch for any business, keeping only the proven safety parts
  (accounts and sign-in, recovery, invitations, isolation, server-side field removal, exact money,
  offline drafts) and their tests.
- 2026-10-07: Computer and phone are equally important.
- 2026-10-07: The first version: work and schedule, customers, invoices and payments, the worker phone
  app, assisted automation, booking and request pages, templates and a shared library. The AI
  assistant comes after launch; until then "describe your business" uses plain word matching.
- 2026-10-07: Launch templates: field service, cleaning and home services, appointments, orders and
  delivery. Structure only, never prices, people or data.
- 2026-10-07: Menus: office gets Today, Work, Customers, Money and Settings plus the inbox and search,
  in the workspace's words; workers get Today, Upcoming and Done.
- 2026-10-07: The look is "calm, bold, friendly" (Spruce and Marigold, Bricolage Grotesque, Figtree,
  JetBrains Mono); red and black are gone.
- 2026-10-07: Demos start empty with a "Show sample data" button.
- 2026-10-07: Old data starts fresh at the switch; the owner confirms the wipe once more at launch.
- 2026-10-07: Docs are four files: PRODUCT.md, DESIGN.md, README.md and CLAUDE.md.
- 2026-10-07: Errors and destructive actions use Clay, a muted rust, with an icon and words; it is
  never a brand colour. (Picked by Claude: the new palette has no red.)
- 2026-10-07: Creating a demo needs an account, so each demo is the visitor's own private workspace.
  (Picked by Claude.)
- 2026-10-08: Launched the rebuild; the old live data (accounts, workspaces) was wiped with the owner's
  yes, so everyone signs up fresh. The old tables stay, empty, until a later clean-up.
