# Rigo product vision

## Purpose

Rigo lets almost any service-business owner create a workspace, configure it around how their
business actually runs, invite employees, and have Rigo take on routine work — preparing
invoices, notifying people, drafting follow-ups and communications — while the owner keeps
control through approvals, pause and takeover.

The first industries are **fuel delivery**, **portable toilet delivery/rental/servicing/pickup**
and **septic services**. A company can offer one or several; every service shares the same
customers, service locations, employees, trucks and equipment. Other industries arrive later
through templates and configuration rather than code.

## Principles

1. **The owner stays in control.** Automation runs within permissions, configured approval
   rules, enabled services and safety limits. Timeouts never approve anything. Pause holds
   work; it never pretends to undo it.
2. **Honest states.** Draft, approved/issued, delivery and payment are separate. Prepared,
   simulated, blocked, sent and failed mean exactly that. Nothing claims a send, a sync or a
   price that did not happen.
3. **Real workspaces start empty.** Templates carry structure; only the demo carries
   fictional sample records. Nothing fictional is copied into a real company.
4. **Isolation by default.** Companies are separate. A personal account grants no company
   access; every company-owned record, file, export, search and assistant answer is scoped
   and permission-checked on the server.
5. **Configuration, not code.** Services, fields, pricing lines, workflows, approvals and
   branding are validated declarative data. No arbitrary scripts, HTML or CSS.
6. **Deterministic money.** Prices, quantities, discounts, taxes and totals are computed with
   exact decimal arithmetic in minor units. Missing rates hold an invoice; they are never zero.
   AI is never the authority for arithmetic, prices, taxes or accounting rules.
7. **Works in the field.** Drivers get a focused phone screen, large controls, offline drafts
   and clear sync status. Only the server's acceptance completes a job.

## People and access

- Anyone can create a personal account. After signing in they can explore the demo, create a
  company (becoming its owner), open companies they belong to, or accept invitations.
- One person can own several companies, work for several, and hold different roles in each.
  Companies can have several owners; the last active owner cannot be removed or demoted.
- Employees join through an emailed (locally: simulated) single-use invitation bound to their
  address, with expiry, revoke, replace, wrong-account guidance and race-safe acceptance.
- Role presets: **Owner**, **Dispatcher**, **Driver**, **Office/billing**. Owners can edit
  role permissions across records, fields, actions, financial visibility, workflow
  configuration, approval authority and member management. Approval authority can be
  delegated for a period.

## The core operational journey

Customer contacts the company → dispatcher records the job (draft allowed, missing
information explained) → dispatcher assigns a driver, truck and equipment (conflicts
prevented) → driver sees it in **My jobs** → driver records actual quantities, notes,
photos, signature and outcome (completed, partial, or unsuccessful with a reason) → the
server accepts the record → Rigo prepares the invoice per the configured workflow → required
approval → issue → company-branded email prepared and sent if a provider is configured
(otherwise left prepared, or simulated in the demo) → payment recorded.

Unsuccessful and partial visits are never treated as ordinary completions: unsuccessful
visits are not billed automatically; partial visits produce a held invoice for review.
Corrections to finished records keep history and invalidate stale approvals.

## Automation and control

- **Modes**: Manual (people start every business action; Rigo lists the next step), Assisted
  (Rigo prepares drafts; anything that commits waits for a person), Automatic (eligible steps
  run). Overridable per workflow and per step.
- **Workflows**: trigger, conditions, steps, approvals (always/conditional, approver roles or
  people, backups, escalation), exception paths, plain-language explanation, validation,
  sample-data testing, and Draft → Tested → Active versions. Editing a tested version creates a
  new draft. Activation is deliberate. Three editors share one versioned definition: guided
  forms, a visual builder, and the assistant.
- **Safety**: approvals bind to the record version and workflow version; execution rechecks
  pause state, workflow version, membership/permission and capability on every attempt
  (including retries); bounded retries with backoff; idempotency keys on every action; event
  depth and per-hour limits against loops and fan-out.
- **Control surfaces**: company and workflow pause (hold or cancel queued work), resume,
  owner takeover of a run, visible queue and history, explanations for blocked steps.

## Assistant

A collapsible side panel on large screens and a dedicated screen on phones. It answers from
the user's authorized data, explains exceptions, and turns plain-language requests into
**workflow proposals** that stay separate from active configuration until accepted, tested and
activated. Without a configured AI provider it uses clearly labeled **prepared responses** and
a rule-based builder. Real AI is behind a replaceable provider boundary, off by default, never
available in the demo, rate-limited per company, and treats company data as untrusted input.

## Expansion

- **Imports**: reviewed CSV imports (customers with locations, trucks/equipment) with limits,
  field mapping, preview, validation, duplicate and ambiguity detection, explicit commit and
  safe failure. Imports never activate workflows or invent relationships.
- **Templates**: reusable structure (services, fields, role permissions, workflows) that can
  be private, shared with chosen people, or public. Applying one copies it; later template
  edits never change a company. Rates, people, records, files and credentials are never shared.
- **Recurring service and rentals**: visit schedules separate from billing schedules,
  time-zone aware, idempotent generation, pauses, future changes, missed-visit detection and
  restart catch-up.
- **Communications**: prepared, simulated, queued, sent, delivered, failed and replied states,
  linked to customers, jobs and invoices; delivery adapters are optional and disabled by default.
- **Branding**: logo and accent color with automatically derived accessible variants, applied
  in the workspace, on invoices and in message previews.

## Demo

One fictional multi-service company per visitor, isolated and resettable, with a guided
dispatch-to-invoice walkthrough, free exploration, simulated role switching, and **Set up my
company** (copies approved structure only). The demo never makes paid AI calls, sends email or
SMS, processes payments, uses paid maps, connects accounts or uploads to external storage; this
is enforced at the server's provider boundary.

## Business model

Creating a real company is free. Monthly charging is a future direction; no price is chosen
and there is no billing implementation in this version.
