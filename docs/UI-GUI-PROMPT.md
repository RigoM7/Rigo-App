# Rigo UI/GUI prompt (self-contained, reusable)

Use this prompt to design, build or review any Rigo screen. It is complete on its own and
describes the current "Light command center" design; `docs/DESIGN-SYSTEM.md` has the exact
tokens and measured contrast.

---

You are designing the interface of **Rigo**, a business management and automation platform for
field-service companies (first: fuel delivery; portable toilet delivery, rental, servicing and
pickup; septic services). Owners configure a company workspace, invite employees, and let Rigo
do routine work (preparing invoices, notifying people, drafting follow-ups and messages) while
they keep control through approvals, pause and takeover. One company may offer several services
that share customers, service locations, employees, trucks and equipment.

## 1. Direction: "Light command center"

- Mission control for a field-service business: the owner opens it and immediately sees the day
  moving. Built for an owner on a desktop first; drivers on phones get a focused version of the
  same look.
- Combines Linear (speed, restraint, keyboard-first, crisp hierarchy), Vercel's dashboard
  (black-and-white precision, Geist type, live status) and fleet tools such as Samsara (drivers,
  trucks and the day's schedule at the center). Money screens borrow Stripe's polished,
  trustworthy treatment of amounts and states.
- Light-first with **black chrome**: a near-black top bar and sidebar frame a bright, light
  workspace. Red is a precise accent.
- **Signature move:** the live dispatch timeline, with driver lanes across the day and a thin
  bright-red "now" line moving across them. Everything else stays quiet and exact.
- Never: a generic admin-template look (purple or blue gradients, rows of identical icon-and-
  heading cards, stock illustrations, big-number "hero metric" tiles, eyebrow labels above
  headings), clutter, important actions hidden in "…" menus or only on hover, gradient text,
  decorative glass or blur, neon glows, colored left borders thicker than 1px, emoji as icons.

## 2. Color and themes

- Red, white and black only, plus neutral grays and functional status colors. Semantic tokens
  only (primitive → semantic → component); never raw hex in components.
- Light (default): canvas #FAFAFA, surface #FFFFFF, raised #F4F4F5, text #0A0A0B, secondary
  #52525B, tertiary #71717A (14px or larger only), borders #E4E4E7, control edges #7A7A84.
- Chrome (top bar, sidebar, bottom nav, demo bar, toasts, bulk bar): #0A0A0B, hover #1C1C1F,
  text #FAFAFA, muted #A1A1AA (never #71717A on chrome: it fails), dividers #27272A, red text
  #F87171.
- Primary: crimson #B91C1C (hover #991B1B) with white text. Bright red #EF4444 only for the
  active-nav marker, the now line, live dots and focus accents; never behind white text.
- Dark (equally polished): canvas #0B0B0D, surface #161618, raised #1C1C1F, text #FAFAFA,
  secondary #A1A1AA, borders #2A2A2F, control edges #7A7A84, chrome #050506 with a #27272A
  divider, primary #DC2626 (hover #B91C1C) with white text, red text #F87171.
- Status (icon + text, never color alone): light success #15803D, warning #B45309, info
  #1D4ED8; dark #4ADE80, #FBBF24, #60A5FA. Danger has its own token and is distinguishable
  from brand red: icon, explicit verb label, outlined style, confirmation stating the
  consequence.
- Contrast: text ≥4.5:1, large text and UI boundaries ≥3:1, in both themes independently.
- Light, Dark and System; Light is the default; saved per account and device.
- Company branding: logo and an accent (with derived accessible light/dark variants) on the
  company chip, invoice header and message previews only. Navigation, controls and primary
  actions always stay Rigo's.

## 3. Typography, shape, density

- Geist for interface text; Geist Mono for data (job numbers, quantities, money, times, IDs,
  table numerals). Mono is for data only. Self-hosted, no font CDN. Base 16px / 1.5, 16px
  inputs, scale 12/13/14/16/18/22/28/36, headings 600, body 400–550, prose 65–75 characters,
  balanced headings, tabular figures.
- Softly rounded: 8px controls, 12px cards/panels/dialogs, full rounding for pills and chips.
  1px borders. Shadows only for overlays and raised panels, with a real offset and soft blur.
- 4px spacing scale; tight groups, generous separation.
- Balanced density: compact tables, roomy forms and detail panels. Operational buttons ≥44px
  (24px minimum elsewhere). Lucide icons only, one stroke weight.
- Theme browser surfaces too: selection, caret, scrollbars, focus rings, link underlines.

## 4. Motion: "live and alive"

- The now line moves across the timeline in real time; live and in-progress items get a slow
  red pulse on their status dot only; changed counts tick to their new value; drawers slide in
  from where they live; timeline blocks slide to a new time.
- 100–150ms feedback, 150–300ms state changes, 300–450ms panels. Exits faster than entrances.
  Ease-out (cubic-bezier(0.16, 1, 0.3, 1)); no bounce. CSS and Web Animations only.
- Reduced motion: everything static (no pulse, numbers jump, the now line jumps, panels appear
  instantly).

## 5. Shell and navigation

- Desktop (≥1024px): black top bar with the wordmark, company switcher (current company
  always visible with its chip), a search field that opens the command menu (Ctrl/⌘ K hint),
  role badge, Assistant link, notification bell (unread count announced properly) and the
  account/theme menu. Black left sidebar with labeled groups that collapses to icons and
  remembers it: Operations (Home, My jobs, Inbox, Jobs, Recurring & rentals), People & places
  (Customers, Team), Fleet (Trucks & equipment), Money (Invoices), Communication (Messages),
  Rigo (Assistant, Automation, Workflows), Setup (Services & pricing, Imports, Templates,
  Settings). Each role sees only what it can use. Active item: #1C1C1F, white text, small red
  marker.
- Command menu (Ctrl/⌘ K): jump to any screen, find jobs, customers and invoices by name or
  number, quick actions (New job, New customer, Record payment, Pause automation, Invite, Ask
  Rigo). Permission-aware, grouped, fully keyboard-driven, recent items first.
- Phone and tablet: black top bar with company context and a search button; bottom navigation
  of at most five destinations (four + More). Tables become labelled cards below 768px. No
  horizontal page scrolling at any width.
- Real routes and deep links (`/c/{company}/...`); filters, sorting and timeline view in the
  URL; predictable back. Switching company never shows the previous company's data.

## 6. Screens

1. Sign in / sign up / forgot / reset: a calm centered card on the canvas with the black Rigo
   wordmark. Password show/hide, autofill and paste allowed. Recovery explains honestly when
   email isn't configured.
2. Workspaces: my companies (chip with logo or accent), pending invitations, free demo, create a
   company. New company flow.
3. Invitation page: company, role, masked intended email; valid, expired, revoked, replaced and
   accepted states; wrong-account guidance; no requirement to create a company first.
4. Resumable company setup: services, automation mode and recommended workflows, trucks, team
   invitations, optional test job, readiness checklist, "Finish later".
5. Owner Home (command center): **Today's timeline** leads. Driver lanes (default) with an
   Unassigned lane on top, hours in the company time zone, blocks with time, customer, service
   and status icon + text sized by the time window, the moving red now line, a job side panel
   on click with assignment by select. Feed view on the same toggle (in the URL). Day
   navigation and filters by service and driver. Around it, compact: a slim **Needs you**
   strip (approvals, held invoices, problems, each with its action as a visible button) and
   **What Rigo is doing**. Real records only; empty companies see setup actions, never
   fictional numbers.
6. Jobs: table by default, switchable to a status board and to the timeline; search, filters,
   sorting in the URL; inline assignment by select; bulk select with a visible action bar.
7. Job form: customer and location (create inline), service-specific fields, requested window,
   contact, access instructions, notes, optional assignment; sticky actions; "Save as draft"
   lists what is missing.
8. Job detail: header with mono number, title, status, customer, when and driver; where and
   who, service requested, recorded outcome with photos and signature, schedule and assignment,
   invoice summary, messages, full history including corrections.
9. Driver "My jobs" (phone): Today, Upcoming, Finished; cards with time (mono), address,
   service, access instructions, status, next action and sync state; readable outdoors.
10. Driver job (phone): essentials first, big "Start job", outcome (completed / partial / could
    not complete + reason), quantities in mono, notes, photos, signature if configured, problem
    report, sticky "Submit to office". Sync states: Saved on this device, Waiting to sync,
    Accepted by the server, Sync failed, Conflict — needs review. One-handed at 375px.
11. Customers and detail; Team (members, invitations, role permission matrix, approval
    delegation); Trucks & equipment; Services & pricing and the service editor (fields, price
    lines, tax, photo/signature requirements; an empty rate shows "Not set").
12. Invoices: list grouped by work state (on hold, draft or awaiting approval, approved, issued
    awaiting payment, paid, void); detail with separate invoice, approval,
    delivery, payment and total cells, the branded document, hold reasons, line editing,
    approve, issue, void, record payment, prepare email, print/save PDF. Amounts mono and
    right-aligned.
13. Inbox: Needs action (approvals with Approve / Edit / Reject and the stated consequence of
    each), Warnings, Updates, Decided; unread shown separately from unresolved.
14. Automation: mode, company pause (hold or cancel queued work) and resume, waiting and queued
    steps (run/dismiss), active runs (take over), history with explanations, connected
    services.
15. Workflows and editor: visual builder (trigger → conditions → steps; add between nodes;
    side panel editing; move up/down) with an equivalent form view, plain-language
    explanation, validation, sample-data tests per mode, Draft → Tested → Active, per-workflow
    pause and mode override, versions and runs.
16. Recurring & rentals (visit schedule separate from billing), Imports (map, review, confirm),
    Templates (apply, share), Messages (prepared / simulated / sent / replied, with a branded
    email preview), Settings (company, branding with live preview, custom fields, connected
    services), Account (theme, password).
17. Assistant, its own full screen: conversation with distinct states (Proposed, Waiting for
    approval, Running, Completed, Failed, Simulated); prepared answers labeled "Prepared
    response (not AI)", AI output labeled as AI; workflow proposals as a card with the
    explanation and Review proposal. Elsewhere only small inline "Ask Rigo" chips (held
    invoices, blocked or failed steps) that open the Assistant with the question prefilled.
18. Demo: an unmistakable black "Demo workspace" bar with a red hazard edge ("Fictional data.
    Nothing is sent, charged or connected."), "View as" role switching, Reset, "Set up my
    company", optional inline walkthrough. Simulated results are labeled Simulated.
19. 404, error, not-a-member and dev mailbox pages in the same style.
20. Printable invoice and customer email preview: always on white, with the company's branding.

## 7. Components and states

- UI kit: buttons (primary, default, ghost, danger), inputs, selects, checkboxes, tabs,
  segmented controls, tables, cards, drawers, dialogs, toasts, status pills, badges, empty
  states, skeletons, command menu, timeline; every state defined (default, hover, focus,
  active, disabled, busy).
- Forms: visible labels, "(optional)", hints, inline errors with an icon, a focused linked error
  summary after a failed multi-field submit.
- Every view: loading (skeletons shaped like the content), empty (with the next action), error
  (with retry), permission denied, offline and stale-data states.
- Honesty: never fake success, invented data or fake progress; unavailable features are
  labeled; no control silently does nothing.
- Dialogs only for confirmations or protected focus; otherwise side panels or inline editing.
- Copy names the action ("Approve invoice", "Assign driver"); errors say what went wrong and
  how to recover.

## 8. Accessibility and acceptance

- WCAG 2.2 AA at 375, 768, 1024 and 1440px, both themes, 200% text, reduced motion, keyboard
  only. Visible 3px focus with 2px offset (also on the black chrome); skip link; semantic
  elements; accessible names containing the visible label; live regions only for meaningful
  changes ("3 items need you", never a bare number); nothing by color alone; sticky bars never
  cover focus; every drag has a select or button alternative.
- Zero serious/critical axe violations on key pages in light and dark; no horizontal overflow
  at the four widths and at 200% text.
- The owner can tell from Home within seconds what is happening today, who is where and what
  needs them, from real records only. A driver can complete a job one-handed at 375px and never
  mistake a local draft for a completed job. The demo is unmistakable.
