# Rigo design system: "Light command center"

Source of truth for tokens: `src/client/styles.css`. Components: `src/client/components/ui.tsx`,
`src/client/components/shell.tsx` (shell, navigation, command menu) and
`src/client/components/timeline.tsx` (live dispatch timeline). Company accent logic:
`src/shared/branding.ts`.

The redesign used the design skills in `.claude/skills/`: `ui-ux-pro-max` (`"field service
operations dashboard command center" --design-system`, plus `chart`, `ux` searches for real-time
dashboards, timelines, command palettes, live badge announcements, tables, loading states and
dark-sidebar contrast), `impeccable` (operate mode and its craft floor), `design-system`
(three-layer tokens, states and variants) and `brand` (voice). Their generic suggestions (a
navy/blue palette, Fira type, bouncy stagger motion) were **not adopted**: the confirmed
red/white/black palette, Geist type and the decisions below take precedence.

## Character

Mission control for a field-service business: the owner opens Rigo and sees the day moving.
It combines Linear's speed and restraint, Vercel's black-and-white precision and live status,
and fleet tools' focus on drivers, trucks and the schedule. Money screens take Stripe's calm,
trustworthy treatment of amounts and states.

- **Light-first with black chrome.** A near-black top bar and sidebar frame a bright light
  workspace. Red is a precise accent, never decoration.
- **One signature move:** the live dispatch timeline, with a thin bright-red "now" line moving
  across driver lanes. Everything else stays quiet and exact.
- **Never:** a generic admin-template look (gradients, rows of identical icon cards, stock
  illustrations, big-number "hero metric" tiles, eyebrow labels above headings), clutter,
  important actions hidden in "…" menus or on hover, gradient text, decorative glass or blur,
  neon glows, colored left borders thicker than 1px on cards or alerts, emoji as icons.

## Tokens: three layers

1. **Primitives** (`--zinc-*`, `--red-*`, `--green-*`, `--amber-*`, `--blue-*`, type sizes
   `--fs-12…36`, `--space-1…8`, radii, durations): raw values. Components never use them.
2. **Semantic** (`--canvas`, `--surface`, `--text`, `--primary`, `--live`, `--chrome-*`,
   `--success` …): meaning, redefined per theme under `:root[data-theme='dark']`.
3. **Component** (`--btn-h`, `--input-h`, `--card-radius`, `--tl-label-w`, `--tl-hour-min` …):
   per-component sizes built on the semantic layer.

No component uses a raw hex value. The two deliberate exceptions are the printable invoice and
the customer email preview, which always render on white because that is what the customer
receives.

## Color

Red, white and black, plus neutral grays and functional status colors.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | #FAFAFA | #0B0B0D | Page background |
| `--surface` | #FFFFFF | #161618 | Cards, panels, dialogs |
| `--surface-2` / `--surface-3` | #F4F4F5 / #E9E9EC | #1C1C1F / #2A2A2F | Hover, raised areas, table heads, skeletons |
| `--text` | #0A0A0B | #FAFAFA | Primary text |
| `--text-2` | #52525B | #A1A1AA | Secondary text |
| `--text-3` | #71717A | #8B8B94 | Tertiary text, 14px or larger only |
| `--border` / `--border-strong` | #E4E4E7 / #C9C9CF | #2A2A2F / #3F3F46 | Dividers (decorative) |
| `--control-border` | #7A7A84 | #7A7A84 | Edges of inputs and buttons (≥3:1) |
| `--primary` | #B91C1C | #DC2626 | Primary buttons, wordmark, counts |
| `--primary-hover` / `--primary-press` | #991B1B / #7F1D1D | #B91C1C / #991B1B | Button states (white text stays ≥4.5:1) |
| `--primary-text` | #B91C1C | #F87171 | Red as text, link hover |
| `--live` | #EF4444 | #EF4444 | **Indicators only**: now line, live dots, active-nav marker, selected command. Never behind white text. |
| `--focus` | #B91C1C | #F87171 | 3px focus outline, 2px offset |
| `--chrome` | #0A0A0B | #050506 | Top bar, sidebar, bottom nav, demo bar, toasts, bulk bar |
| `--chrome-hover` / `--chrome-active` | #1C1C1F | #1C1C1F | Hover and active nav item |
| `--chrome-text` / `--chrome-muted` | #FAFAFA / #A1A1AA | same | Text on chrome. **Never #71717A on chrome** (4.09:1 fails). |
| `--chrome-divider` | #27272A | #27272A | Lines on chrome |
| `--chrome-red-text` / `--chrome-focus` | #F87171 | #F87171 | Red text and focus on chrome |
| `--success` / `--warning` / `--info` | #15803D / #B45309 / #1D4ED8 | #4ADE80 / #FBBF24 / #60A5FA | Status (with `-soft` backgrounds) |
| `--danger` | #B42318 | #FCA5A5 | Errors and destructive actions |

Links are text-colored with a visible underline (never color alone) and turn red on hover.

Measured contrast (WCAG 2.x formula):

| Pair | Ratio |
|---|---|
| Text on canvas (light / dark) | 18.96 / 18.84 |
| Secondary text on surface (light / dark) | 7.73 / 7.05 |
| Tertiary text on surface (light / dark) | 4.83 / 5.35 |
| White on primary (light / dark) | 6.47 / 4.83 |
| White on primary hover (light / dark) | 8.31 / 6.47 |
| Red text: #B91C1C on white / #F87171 on dark surface | 6.47 / 6.53 |
| Chrome text / muted text on chrome | 18.96 / 7.72 (6.63 on hover) |
| Red text #F87171 on chrome | 7.15 |
| `--live` #EF4444 as an indicator: on white / chrome / dark surface | 3.76 / 5.26 / 4.80 (non-text, ≥3:1) |
| Now-line label (#0A0A0B on #EF4444) | 5.26 |
| Control border #7A7A84 on white / dark surface | 4.25 / 4.25 |
| Focus ring: light on white / canvas, dark, on chrome | 6.47 / 6.20, 7.11, 7.15 |
| Status text on soft backgrounds (light) | 4.79–6.16 |
| Status text on soft backgrounds (dark) | 6.84–9.61 |

**Errors and destructive actions are not brand red.** They use the `danger` token, an icon,
explicit verb labels ("Cancel job", "Void invoice", "Reject"), the outlined `btn-danger` style
and a confirmation that states the consequence.

### Themes

Light, Dark and System. **Light is the default.** The choice is saved to the account and the
device, applied before first paint, and System follows `prefers-color-scheme` live. The chrome
stays black in both themes (it sinks to #050506 in dark so it still frames the canvas). Both
themes are scanned independently by axe.

### Company branding

Logo (PNG/JPEG/WebP ≤512 KB, SVG rejected) and an accent from presets or hex. `accentVariants()`
derives a light variant (≥4.5:1 with white text) and a dark variant (≥4.5:1 on dark surfaces)
and rejects colors that cannot be made readable. The accent appears **only** on the company
chip (switcher and workspace list), the invoice header and the customer message preview.
Navigation, controls and primary actions always stay Rigo's. Settings → Branding shows a live
preview of all three places.

## Typography

- **Geist** (variable) for all interface text; **Geist Mono** (variable) for data: job
  numbers, quantities, money, times, dates in tables, IDs and table numerals. Mono is for data
  only, never decoration.
- Self-hosted via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (no font
  CDN; works offline in the PWA).
- Base 16px / 1.5. Inputs are 16px. Scale: 12, 13, 14, 16, 18, 22, 28, 36. Headings weight 600
  with tight tracking (−0.02em); body 400–550. Prose areas stay within 65–75 characters.
  Multi-line headings are balanced. No uppercase labels.
- Tabular figures wherever numbers line up.

## Shape, depth, spacing, density

- Softly rounded: 8px controls, 12px cards, panels and dialogs, full rounding for pills, chips
  and suggestions. 1px borders.
- Shadows only for overlays and raised panels (menus, dialogs, drawers, toasts, the bulk bar,
  hovered timeline blocks), always with a real offset and soft blur.
- 4px spacing scale. Tight groups, generous separation, more space above a heading than below.
- Balanced density: compact tables (12px cell padding, 13px headers) and roomy forms and
  detail panels. Operational buttons are 44px tall; small buttons 34px; nothing below 24px.
- **Lucide** icons only, one stroke weight. Decorative icons are `aria-hidden`; icon-only
  buttons have accessible names.
- Browser surfaces come from the palette: text selection, caret, scrollbars, focus rings and
  link underlines.

## Motion: "live and alive"

Motion explains state and makes the business feel live; it never decorates.

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | Feedback: hover, press, color |
| `--dur` | 200ms | State changes, menus, dialogs, toasts |
| `--dur-slow` | 360ms | Drawers, timeline blocks sliding to a new time |
| `--ease` | cubic-bezier(0.16, 1, 0.3, 1) | Arrivals; exits are faster |

- The now line glides across the timeline (updated every 30 seconds, 1s linear transition).
- Live and in-progress items get a slow red pulse on their status dot only.
- Changed counts tick to their new value (`TickNumber`).
- Drawers slide in from the right edge; dialogs and menus rise slightly into place.
- CSS and the Web Animations API only; no animation library.
- **Reduced motion:** all durations become 0, the pulse is removed, numbers jump, the now line
  jumps, panels appear instantly.

## App shell

- **Desktop (≥1024px):** black top bar with the wordmark, company switcher (chip, name, menu
  of every workspace), role badge, a search field that opens the command menu (shows the
  Ctrl/⌘ K hint), an Assistant link, the notification bell (unread count announced as
  "N unread") and the account/theme menu. Black left sidebar with labeled groups:
  Operations (Home, My jobs, Inbox, Jobs, Recurring & rentals), People & places (Customers,
  Team), Fleet (Trucks & equipment), Money (Invoices), Communication (Messages), Rigo
  (Assistant, Automation, Workflows), Setup (Services & pricing, Imports, Templates, Settings).
  Each role sees only what its permissions allow. The active item has a #1C1C1F background,
  white text and a small rounded red marker. The sidebar collapses to icons and remembers it.
- **Command menu (Ctrl/⌘ K, or the search field):** jump to any screen, find jobs, customers
  and invoices by name or number, and quick actions (New job, New customer, Record payment,
  Pause/Resume automation, Invite a team member, Ask Rigo). Permission-aware (it never lists
  something the person cannot open or do; the server checks again). Grouped, fully keyboard
  driven (combobox + listbox), recent records first.
- **Phone and tablet (<1024px):** black top bar with company context and a search button for
  the command menu; black bottom navigation of **at most five** destinations (four + More,
  grouped the same way). Tables become labelled cards below 768px. No horizontal page scroll.
- Real routes and deep links (`/c/{company}/...`). Filters, sorting, the jobs view, the
  timeline day, view and filters all live in the URL. Switching company remounts everything so
  no data from the previous company appears, not even for a frame.
- Sticky elements never cover content or focus: `scroll-padding`, bottom padding for the nav,
  the demo walkthrough is inline, toasts sit bottom-right above the nav.

## The live dispatch timeline

`DispatchTimeline` (Home and Jobs → Timeline):

- **Lanes (default):** an Unassigned lane on top (warning-tinted), then one lane per driver
  with their trucks. Hours across the day in the company time zone, from an hour before the
  first job (or now) to an hour after the last, at least eight hours. Hours share the card
  width; below a minimum width the timeline scrolls inside its card and opens scrolled to now.
- **Blocks:** time and job number (mono), customer, status icon + text and service; sized by
  the time window; overlapping jobs stack in rows. Left edge color by status (open blue,
  in progress red with a live dot, completed green, partial amber, unsuccessful danger, draft
  dashed). Problems get a danger outline and a "Problem" label.
- **Now line:** 2px `--live` line with a mono time label, past hours lightly shaded.
- **Interaction:** every block is a button in a per-lane list ("Dana Driver: 2 jobs"); its
  accessible name includes time, number, customer, status, service, end time and driver.
  Clicking opens the **job side panel** (drawer) with essentials, assignment by select (with
  Save) and Open job / Edit. No dragging is needed.
- **Feed view** (same toggle, `?tl=feed`): one vertical timeline of the day's jobs in time
  order with a "Now" marker.
- Day navigation (previous, Today, next) and filters by service and driver.

## Components

| Component | Rules |
|---|---|
| Button | 44px; primary (filled crimson), default (outlined), ghost, danger (outlined + icon). States: hover, focus, active (1px press), disabled (50%), busy (spinner, `aria-busy`). |
| Field | Visible label; "(optional)"; hint via `aria-describedby`; inline error with icon; invalid fields get a danger border and `aria-invalid`. Numeric fields use mono. |
| ErrorSummary | After a failed multi-field submit: `role="alert"`, focused, links to each field. |
| Pill (status) | Always icon + text. In progress uses a live dot. |
| Banner | info / warning / danger / success with icon; danger is `role="alert"`. |
| Dialog | Native `<dialog>` for confirmations and protected focus only. |
| Drawer | Native modal `<dialog>` sliding in from the right; used for the job side panel. |
| Command menu | Native `<dialog>` with a combobox and listbox; selected option marked with a red inset edge. |
| Table | 13px header row on `--surface-2`, 14px rows, mono numbers, money right-aligned; group header rows for grouped lists; bulk-select column with a black bulk action bar. Labelled cards below 768px. |
| Tabs / Segmented | Tabs underline in text color with mono counts; segmented controls are a soft track with a raised selected item. |
| Empty / Loading / Error | Empty states have an icon box, a heading and a next action; skeletons are shaped like the page; errors offer retry; 403/404 explained. |
| Toast | Black, bottom-right, `role="status"`, dismissible, 6s. |
| Ask Rigo | Small outlined chip that opens the Assistant with a prefilled question (held invoices, blocked or failed steps). |

## Screens (summary)

Home is the command center: date, live clock and company; a slim **Needs you** strip (each item
with its action as a visible button); the timeline; then **What Rigo is doing** and **Last 30
days** (side by side below the timeline, or a right column at ≥1680px). Records (job, invoice)
use a header with a mono number chip, the title, status and a metadata row, with a two-column
detail layout. Invoices are grouped by work state and show invoice, approval, delivery,
payment and total as separate cells. The inbox states the consequences of approve, reject and
edit as a three-row table. Auth pages are a centered card on a dotted canvas. Standalone pages
(workspaces, account, dev mailbox) use the black chrome bar. Full screen list:
`docs/UI-GUI-PROMPT.md`.

## Density by role

- **Owner/dispatcher:** timeline, tables, filters, board and bulk actions.
- **Driver:** one column (max 640px), big time in mono, address first, 56px choice rows,
  large quantity inputs in mono, sticky "Submit to office", sync state always visible.

## Accessibility checklist (verified by `e2e/run.mjs` unless noted)

- axe WCAG 2.0/2.1/2.2 A+AA: no serious or critical violations on 18 pages (including the
  timeline in lanes and feed views), light and dark.
- No horizontal page overflow at 375, 768, 1024, 1440px, and at 200% text on 375px.
- Skip link first; visible focus outline (red, also on the chrome); logical order; native
  controls; accessible names that contain the visible label (WCAG 2.5.3).
- Reduced motion honored (`--dur` is 0).
- Error summary receives focus on failed sign-up.
- Command menu, timeline side panel and sidebar collapse are exercised by keyboard and pointer.
- Dragging is never required: assignment uses selects, field and step order use Move up/down.
- Manual review still recommended with a screen reader (VoiceOver/TalkBack): not automated.
