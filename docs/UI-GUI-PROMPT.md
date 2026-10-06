# Rigo UI/GUI prompt (self-contained, reusable)

Use this prompt to design or build any Rigo screen, or to review one. It is complete on its own.

---

You are designing the interface of **Rigo**, a business management and automation platform for
field-service companies (first: fuel delivery; portable toilet delivery, rental, servicing and
pickup; septic services). Owners configure a company workspace, invite employees, and let Rigo
do routine work — preparing invoices, notifying people, drafting follow-ups and messages — while
they keep control through approvals, pause and takeover. One company may offer several services
that share customers, service locations, employees, trucks and equipment.

## 1. Brand and themes

- Personality: polished, technology-focused, confident, professional. Restrained.
- Palette is **red, white and black** only, plus neutral grays and functional status colors.
  - Rich crimson for brand and primary actions: light #B91C1C (hover #991B1B), dark #DC2626
    (hover #B91C1C). White text on these.
  - Bright red #EF4444 only for highlights and active indicators — never as a background
    behind white text (3.76:1 fails).
  - Light: canvas #FAFAFA, surface #FFFFFF, text #111111, secondary #52525B, borders #E4E4E7,
    control edges #7A7A84. Dark: canvas #0B0B0D, surface #161618, text #FAFAFA, secondary
    #A1A1AA, borders #2A2A2F, control edges #7A7A84, red text #F87171.
- Light, Dark and System themes. Light is the default. Preference persists per account and
  device. Define colors as semantic tokens; never hardcode hex in components. Verify contrast in
  both themes independently: text ≥4.5:1, large text and UI boundaries ≥3:1.
- Errors and destructive actions must be distinguishable from brand red: danger token + icon +
  explicit verb label + outlined style + confirmation that states the consequence.
- Company branding: logo and an accent color with automatically derived accessible light/dark
  variants, used for the company chip, active nav indicator, invoice header and message previews.
  Navigation, controls and primary actions remain Rigo's. No custom company CSS or scripts.

## 2. Typography and components

- Poppins 600/700 headings; Open Sans 400/600/700 body; self-hosted. Base 16px, line-height 1.5;
  16px inputs; tabular numbers in tables and totals.
- Slightly rounded corners (8px controls, 12px cards), subtle 1px borders, restrained shadows,
  4px spacing scale, Lucide icons only (no emoji as icons).
- Buttons ≥44px tall for operational actions; primary/default/ghost/danger variants; busy state.
- Forms: visible labels, "(optional)" markers, hints, inline errors with icon, linked focused
  error summary after failed multi-field submit, password show/hide, paste and autofill allowed.
- Status always as icon + text pill, never color alone.
- Tables become labelled cards below 768px. No whole-page horizontal scrolling.
- Every view has loading (skeleton), empty (with next action), error (with retry), permission
  denied, offline and stale-data states. Never show fake success, invented data or fake progress.
- Unavailable or deferred features are labeled as such; controls never silently do nothing.

## 3. Navigation by role

- Desktop (≥1024px): sticky top bar with brand, **company switcher** (current company always
  visible, with logo/accent), role badge, assistant toggle, notification bell, account/theme
  menu; grouped left sidebar with clear active state; collapsible assistant side panel ≥1280px.
- Mobile: top bar with company context; bottom navigation of at most five destinations (four +
  More); a dedicated assistant screen.
- Real routes and deep links (`/c/{company}/...`); predictable back behavior. Switching company
  must never show the previous company's data.
- Owner: Home, Inbox, Jobs, Customers, Recurring & rentals, Trucks & equipment, Invoices,
  Messages, Automation, Workflows, Assistant, Team, Services & pricing, Imports, Templates,
  Settings. Dispatcher: operations-focused subset. Driver: My jobs, Inbox, Assistant, More.
  Office/billing: customers, invoices, messages, payments.

## 4. Screens

1. Sign up / sign in / password recovery (recovery explains when email isn't configured).
2. Workspaces: my companies, pending invitations (accept), free demo, create company.
3. Invitation page: company and role, masked intended email, valid/expired/revoked/replaced/
   accepted states, wrong-account guidance, no requirement to create a company first.
4. Resumable company setup: services, automation mode + recommended workflows, trucks, team
   invitations, optional test job; readiness checklist; "Finish later".
5. Owner home, in this order: (1) Needs you — approvals and items needing attention;
   (2) Today's operations; (3) What Rigo is doing; (4) Brief business overview from real records.
   Empty companies show setup actions, never fictional numbers.
6. Dispatcher jobs: list/table default, switchable status board and day schedule by driver;
   search, filters, sorting in the URL; inline assign via select (no drag required).
7. Job form: customer + location (create inline), service with service-specific fields,
   requested time window in the company time zone, contact, access instructions, notes,
   optional assignment; Save as draft with a list of what is missing.
8. Job detail: where/who, service requested, recorded outcome with photos/signature, schedule
   and assignment, invoice summary, messages, full history including corrections.
9. Driver "My jobs": Today / Upcoming / Finished; each card shows time, address, service,
   access instructions, status, next action and sync state.
10. Driver job: essentials first; big "Start job"; outcome (completed / partial / could not
    complete + reason); service-specific quantities; notes; photos; signature if configured;
    problem report; sticky "Submit to office"; states: Saved on this device, Waiting to sync,
    Accepted by the server, Sync failed, Conflict — needs review.
11. Customers and locations; Team (members, invitations, role permission matrix, approval
    delegation); Trucks & equipment; Services & pricing (fields, price lines, tax, photo/
    signature requirements; empty rate = not set).
12. Invoices: list by work state; detail with branded document preview, hold reasons, line
    editing, approve, issue, void, record payment, prepare email, print/save PDF; draft,
    approval, delivery and payment states shown separately.
13. Inbox: Needs action (approvals with Approve / Edit / Reject and stated consequences), Warnings,
    Updates, Decided; unread separate from unresolved.
14. Automation: mode, company pause (hold or cancel queued work) and resume, waiting/queued
    steps (run/dismiss), active runs (take over), history with explanations, connected services.
15. Workflows: list; editor with visual builder (trigger → conditions → steps, add step
    between nodes, side panel editing, move up/down) and an equivalent form view; plain-language
    explanation; validation errors/warnings; sample-data test results per mode; Draft → Tested →
    Active lifecycle; per-workflow pause and mode override; versions and runs.
16. Recurring & rentals (visit schedule separate from billing schedule), Imports (map, review,
    confirm), Templates (apply, share), Messages (prepared/simulated/sent/replied), Settings
    (company, branding, custom fields, connected services), Account (theme, password).

## 5. Assistant and approvals

- Assistant states must be distinct: Proposed, Waiting for approval, Running, Completed,
  Failed, Simulated. Label prepared responses "Prepared response (not AI)"; label real AI output
  as AI. Proposals are separate from active configuration until accepted, tested and activated.
- Approvals always show what will happen if approved, what happens if rejected (nothing already
  done is undone), that editing makes the request out of date, and escalation status. Timeouts
  never approve.

## 6. Demo labeling

The demo is clearly marked everywhere: a black "Demo workspace" bar with "Fictional data.
Nothing is sent, charged or connected.", simulated role switching ("View as"), Reset, "Set up my
company", an optional guided walkthrough shown inline (not floating over content). Simulated
results are labeled Simulated.

## 7. Responsive and accessibility requirements

- WCAG 2.2 AA. Verify at 375, 768, 1024 and 1440px, portrait and landscape, both themes, 200%
  text, reduced motion, keyboard only.
- Visible focus (3px outline, 2px offset); skip link; logical focus order; semantic controls;
  accessible names and states; no information by color alone; sticky bars and overlays never
  cover content or focus; dragging always has a button/select alternative.
- Motion is subtle (120–200ms), meaningful and interruptible; none under reduced motion.

## 8. Acceptance criteria

- Zero serious/critical axe violations on key pages in light and dark.
- No horizontal page overflow at the four widths and at 200% text.
- Every interactive control ≥44px tall for operational actions (≥24px minimum elsewhere).
- Each form shows inline errors and a focused, linked error summary on failed submit.
- Driver can complete a job on a 375px phone with one hand, see sync state, and never mistake a
  local draft for a completed job.
- Owner can tell from Home what needs them, what Rigo is doing, and whether operations are on
  track — from real records only.
- Demo is unmistakable; real companies never show fictional data.
