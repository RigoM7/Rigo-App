# Rigo product

Where Rigo is going. This is the vision, not a list of what exists: what is built today, and how
far it is from this, is in `docs/FEATURES.md` (its "Gap to PRODUCT.md" table). A request that
conflicts with this file is flagged before it is built.

## 1. What Rigo is

A place where anyone runs their business, whatever the industry and whether it's a company or a
team. People download Rigo, create an account, and create a workspace or join someone else's. They
set the workspace up the way their business works (its records, roles, words and workflows) and
Rigo takes on the routine: preparing invoices, telling people what changed, drafting follow-ups and
messages. Rigo itself belongs to no industry.

Rigo ships as native App Store and Google Play apps (today it is a web app that installs from the
browser).

## 2. Rules for every workspace

1. **The owner decides how much is automated** and stays in control through permissions,
   approvals, pause and takeover.
2. **Honest states.** Nothing claims a send, sync, payment, price or approval that didn't happen.
   Simulated and demo output is labeled.
3. **Workspaces start empty and private.** No fictional data in a real workspace; each workspace's
   data is isolated and permission-checked on the server.
4. **Configuration, not code.** Owners set everything up in the app, as validated data; never
   scripts, HTML or CSS.
5. **Exact money.** Prices, quantities, discounts, taxes and totals are exact; a missing price holds
   an invoice; AI never decides prices, taxes or totals.
6. **Works on the go.** People away from a desk get focused phone screens, large controls and
   offline drafts; only the server's acceptance completes work.

## 3. Accounts and people

- Anyone can create an account. One account can own workspaces and work in other people's, with a
  different role in each.
- An owner adds someone by the email they use for Rigo. The person sees a pending invitation and
  accepts it; if they don't have an account yet, it waits until they sign up with that email.
- The owner assigns the role. A workspace can have several owners; the last owner can't leave.

## 4. Your words, your roles

- The owner renames everything core: roles, the work record, customers, resources (a salon says
  Appointment, Client, Stylist; a fuel company says Job, Customer, Driver).
- The owner adds, renames and removes roles and sets what each may see and do. The Owner role
  always exists and can always do everything.

## 5. Work

- **One main work record**, named by each workspace (Job, Appointment, Order, Visit…), with
  scheduling, assignment and billing built in, plus the fields the owner adds.
- **Work comes in four ways:** staff create it; customers request it through a request form or
  booking page; it is imported from a file; or schedules and workflows create it.
- **Stages are built by the owner**, from nothing or from a template:
  - each stage is tagged with a meaning (Open, Active, Finished, Cancelled or Failed), so Rigo can
    bill, report and stay honest whatever the names are;
  - work moves when people move it or automations move it, freely or only along paths the owner
    allows;
  - a stage can require information before work enters it, set who sees and acts on it, fire
    automations on entry, and need an approval to leave.
- **Failed or partial work:** the owner decides how it's handled.
- **Building blocks every workspace can use:** records and custom fields, scheduling and recurring
  work, invoices and payments, messages, imports.

## 6. Automation

- **Three levels:** Manual (people start every step; Rigo suggests the next one), Assisted (Rigo
  prepares; a person approves) and Automatic (Rigo does it).
- **Set at four places:** the whole workspace, a workflow, a step, and a person or role. When they
  disagree, the safest one (the one asking for more human involvement) wins.
- **Need a person by default:** anything that moves money, deleting data, and a workflow's first
  real run. The owner can switch each off after a clear warning.
- **Controls:** pause everything or one workflow, take over a running automation, test on sample
  data before turning anything on, and an activity log of what Rigo did and why something was
  blocked.
- **Approvals:** the owner picks the approver roles or people per workflow or step; approval
  authority can be delegated for a period; approvals can be decided with one tap from a phone
  notification. There is no escalation, and nothing ever approves itself (timeouts never approve).
- **Building workflows:** tell the assistant in plain words, use guided forms or the visual
  builder, or start from templates.

## 7. Assistant

Answers questions from the workspace's own data, turns plain requests into workflow proposals, and
sets up a whole workspace from a description ("I run a mobile dog-grooming business"). Everything
it proposes waits for the owner's approval. Real AI is optional, never used in demos, and never the
authority for money.

## 8. Templates and the library

- A template is a workspace's structure (record types, fields, stages, roles, vocabulary,
  workflows), never its prices, people or data.
- A new workspace picks a template or starts empty.
- Any owner can publish their workspace as a template to a shared library that other Rigo users
  browse and use. Applying a template copies it; later edits to the template never change a
  workspace.
- Fuel delivery, portable toilets and septic is the first template. It is built only from Rigo's
  general features, as proof that the platform works.

## 9. Demo

Anyone can try any template. A demo opens empty, and a "Show sample data" button turns sample data
on. Demos never send, charge, connect or call a paid service.

## 10. Branding

Rigo's look is the default. A workspace may customize the look freely if it wants to; readability
is always kept, and the Rigo name stays visible somewhere.

## 11. Next steps

1. Custom vocabulary and roles.
2. Setting up any workspace from scratch.

## 12. Business model

Creating a workspace is free. Pricing is undecided; no billing is built.

## Decisions

One line per decision, newest last.
- 2026-10-07: Rigo is a platform for any business; field service becomes the first template.
- 2026-10-07: Migrations wait for launch and stay out of preview pushes, because previews share the
  live database.
- 2026-10-07: Only launching (merging into `main`) needs the owner's approval.
- 2026-10-07: Email (Resend or Postmark) and texts (Twilio) stay off until the owner sets their keys;
  until then recovery uses owner-created reset links.
- 2026-10-07: The black "Try the demo" button (commit 685334e) was not kept.
