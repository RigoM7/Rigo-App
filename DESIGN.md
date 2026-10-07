---
version: alpha
name: Rigo — Light command center
description: >-
  Rigo's current look: a bright light workspace framed by near-black chrome, with red as a precise
  accent and Geist type. Light theme values; the dark theme is described in the Colors section.
  Not locked: any request can change it.
colors:
  primary: "#B91C1C"
  primary-hover: "#991B1B"
  primary-press: "#7F1D1D"
  on-primary: "#FFFFFF"
  primary-soft: "#FEF2F2"
  live: "#EF4444"
  canvas: "#FAFAFA"
  surface: "#FFFFFF"
  surface-2: "#F4F4F5"
  surface-3: "#E9E9EC"
  text: "#0A0A0B"
  text-2: "#52525B"
  text-3: "#71717A"
  border: "#E4E4E7"
  border-strong: "#C9C9CF"
  control-border: "#7A7A84"
  chrome: "#0A0A0B"
  chrome-hover: "#1C1C1F"
  chrome-text: "#FAFAFA"
  chrome-muted: "#A1A1AA"
  chrome-divider: "#27272A"
  chrome-red-text: "#F87171"
  success: "#15803D"
  success-soft: "#F0FDF4"
  warning: "#B45309"
  warning-soft: "#FFFBEB"
  info: "#1D4ED8"
  info-soft: "#EFF6FF"
  danger: "#B42318"
  danger-soft: "#FEF3F2"
typography:
  display:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.02em
  title:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: Geist Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: '"tnum"'
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
  tap: 44px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: 44px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: 44px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: 44px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
  chrome:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.chrome-text}"
  chrome-muted:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.chrome-muted}"
  status-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
  status-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
  status-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
  status-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
  toast:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.chrome-text}"
    rounded: "{rounded.md}"
---

# Rigo design

How Rigo looks, moves and feels, and which design skills turn the owner's words into a design.
What the app does is in `docs/FEATURES.md`; a look change keeps every Working feature working. The
tokens above follow Google's DESIGN.md format (`.claude/skills/design-md`) and match
`src/client/styles.css`, which is the source of the real values. To change the look, find the
request in "Your words → skill" at the end of this file.

## Overview

**Current direction: "Light command center".** Nothing here is locked. A fresh direction for a
platform that serves any business will be proposed with `impeccable` and `ui-ux-pro-max` and shown
to the owner before it replaces this one.

Mission control for a business: the owner opens Rigo and sees the day moving. It takes Linear's
speed and restraint, Vercel's black-and-white precision and live status, and fleet tools' focus on
people, equipment and the schedule. Money screens take Stripe's calm, trustworthy treatment of
amounts and states.

- **Light-first with black chrome:** a near-black top bar and sidebar frame a bright, light
  workspace. Red is a precise accent, never decoration.
- **One signature move:** the live schedule timeline, with a thin bright-red "now" line moving
  across the workers' lanes. Everything else stays quiet and exact.
- **Avoided so far:** generic admin-template looks (gradients, rows of identical icon cards, stock
  illustrations, big "hero metric" tiles), clutter, important actions hidden in "…" menus or on
  hover, emoji as icons. A skill or the owner can change any of this.

## Colors

Red, white and black, plus neutral grays and status colours, in three layers: primitives (raw
values), semantic tokens (meaning, redefined per theme) and component tokens. Components only use
semantic or component tokens, never raw hex. The printable invoice and the customer email preview
are the exceptions: they always render on white, because that is what the customer receives.

- **Crimson (`primary` #B91C1C; dark theme #DC2626):** primary buttons, the wordmark, counts. White
  text on it stays at least 4.5:1.
- **Live red (`live` #EF4444):** indicators only (the now line, live dots, the active-nav marker),
  never behind text.
- **Chrome (#0A0A0B; dark theme #050506):** top bar, sidebar, bottom navigation, demo bar, toasts,
  bulk bar. Text on chrome is #FAFAFA or #A1A1AA, never #71717A (it fails contrast there).
- **Neutrals:** canvas #FAFAFA, surfaces #FFFFFF / #F4F4F5 / #E9E9EC, text #0A0A0B / #52525B /
  #71717A (the lightest only at 14px or larger). Dark theme: canvas #0B0B0D, surfaces #161618 /
  #1C1C1F / #2A2A2F, text #FAFAFA / #A1A1AA / #8B8B94.
- **Status:** success, warning, info and danger, each with a soft background; dark theme uses
  #4ADE80, #FBBF24, #60A5FA and #FCA5A5. Status is always an icon plus text, never colour alone.
- **Danger is not brand red:** errors and destructive actions use the danger token, an icon, an
  explicit verb ("Void invoice"), an outlined button and a confirmation that states the consequence.
- **Themes:** Light (default), Dark and System, saved to the account and the device and applied
  before first paint. Text selection, caret, scrollbars, focus rings and link underlines come from
  the palette. Links are text-coloured with an underline and turn red on hover.

## Typography

- **Geist** for all interface text; **Geist Mono** for data only: job numbers, quantities, money,
  times, IDs and table numbers, with tabular figures. Both are self-hosted (no font service; they
  work offline).
- Base 16px / 1.5; inputs are 16px. Scale: 12, 13, 14, 16, 18, 22, 28, 36. Headings weight 600 with
  tight tracking; body 400–550. Prose stays within 65–75 characters; multi-line headings are
  balanced. No uppercase labels.

## Layout

- 4px spacing scale; tight groups, generous separation, more space above a heading than below.
- Balanced density: compact tables, roomy forms and detail panels.
- **App frame (1024px and wider):** black top bar (wordmark, workspace switcher, role badge, search
  that opens the command menu, Assistant, notification bell, account and theme menu) and a black
  sidebar with labeled groups that collapses to icons and remembers it. Each role sees only what it
  may use.
- **Phones and tablets:** black top bar with the workspace and a search button; bottom navigation of
  at most five destinations (four plus More). Tables become labeled cards below 768px. No horizontal
  page scroll at any width.
- **Command menu (Ctrl/⌘ K):** jump to any screen, find records by name or number, quick actions;
  permission-aware, grouped, fully keyboard driven, recent items first.
- **Density by role:** owners and dispatch get the timeline, tables, filters and bulk actions;
  workers get one column (max 640px), big times in mono, the address first, large inputs and the
  sync state always visible.

## Elevation & Depth

Flat surfaces separated by tone and 1px borders. Shadows only for overlays and raised panels
(menus, dialogs, drawers, toasts, the bulk bar, hovered timeline blocks), always with a real offset
and a soft blur. The black chrome frames the light workspace instead of shadows.

## Shapes

Softly rounded: 8px controls, 12px cards, panels and dialogs, full rounding for pills, chips and
suggestions; 1px borders. Timeline blocks carry a 3px status edge on purpose, because a dispatcher
scans dozens of them at once; the status is also in the block's text.

## Components

Rules for the components in `src/client/components/ui.tsx`:
- **Button:** 44px (34px small); primary (filled crimson), default (outlined), ghost, danger
  (outlined with an icon). States: hover, focus, active, disabled, busy (spinner).
- **Field:** visible label, "(optional)", hint, inline error with an icon; numeric fields in mono.
  A failed multi-field submit shows a focused error summary linking to each field.
- **Status pill:** always icon plus text; in progress has a live dot; Urgent, Emergency and Late
  pills.
- **Banner, dialog, drawer, toast:** banners by tone with an icon; dialogs only for confirmations;
  the job side panel is a drawer from the right; toasts are black, bottom-right, 6s, or 12s with an
  Undo.
- **Table:** 13px header row, 14px rows, mono numbers, money right-aligned, grouped rows, a black
  bulk action bar.
- **Every view:** loading (skeletons shaped like the content), empty (with the next action), error
  (with retry), permission denied, offline and stale states. Unavailable features are labeled,
  never silently inert.
- **Key patterns:**
  - *Schedule timeline:* an Unassigned lane on top, then a lane per worker; hours in the company's
    time zone; blocks sized by their time window, leading with the customer; the moving now line;
    clicking a block opens the side panel with assignment by select. A feed view shows the day in
    time order.
  - *Needs you:* three tiers, rows not chips: "Act now" in a danger box with the page's one primary
    action, "To do today" as a plain list where each row has its own button, "When you have a
    minute" folded away.
  - *Worker phone view:* a footer bar with a one-line sync status and exactly one full-width primary
    action; details stack label above value on narrow screens.
  - *Money facts:* the customer page leads with Next visit and Owes.

## Do's and Don'ts

- Do use semantic tokens and existing components; add a component only when nothing fits.
- Do show status as icon plus text, and name actions with verbs ("Approve invoice").
- Do keep every flow usable with selects and buttons; dragging is never required.
- Don't fake success, progress or data; label anything simulated.
- Don't put live red behind text or muted gray (#71717A) on the chrome.

## Motion

Motion explains state and makes the business feel live.
- Durations: 120ms feedback (hover, press), 200ms state changes (menus, dialogs, toasts), 360ms
  panels and timeline blocks moving. Ease `cubic-bezier(0.16, 1, 0.3, 1)` for arrivals; exits are
  faster. CSS and the Web Animations API only.
- The now line glides across the timeline; live items get a slow red pulse on their status dot;
  changed counts tick to their new value; drawers slide in from the right.
- **Reduced motion:** all durations become 0, the pulse stops, numbers and the now line jump,
  panels appear instantly.

## Workspace branding

Today a workspace sets a logo (PNG, JPEG or WebP up to 512 KB) and an accent colour.
`accentVariants()` in `src/shared/branding.ts` derives readable light and dark variants and refuses
colours that can't be made readable. The accent shows on the workspace chip, the invoice header and
message previews; Settings → Branding previews all three. The vision (`PRODUCT.md`) lets a workspace
customize the look freely, with readability kept and the Rigo name visible somewhere.

## Phones and native apps

Phone-first layouts at 375px, one-handed operation for workers, operational buttons at least 44px.
Today Rigo installs from the browser (manifest, icons, service worker). When the native App Store and
Google Play apps are built, follow each platform's conventions (`impeccable adapt` has native
references).

## Accessibility floor

Kept whatever the direction, because skills don't check it reliably. WCAG 2.2 AA in both themes:
text at least 4.5:1 and large text and control edges at least 3:1; a visible 3px focus outline (also
on the chrome); a skip link; accessible names that contain the visible label; nothing by colour
alone; no horizontal scroll at 375, 768, 1024 and 1440px or at 200% text; reduced motion honored;
keyboard-only use. `e2e/run.mjs` checks these with axe on every pull request; screen-reader
walkthroughs are still manual.

## Research and licences

Visual ideas can come from open-source projects. Rigo has no open licence, so:
- copy or adapt code or assets only from MIT, Apache-2.0, BSD, ISC or CC0 projects, keep their
  notices and list them in `THIRD_PARTY_NOTICES.md`;
- GPL, AGPL, LGPL, SSPL, Elastic, BSL and custom-licence projects are for ideas only.

Borrowed so far (patterns only, rebuilt in Rigo's own CSS; no code copied):

| Rigo | Pattern from | Licence |
|---|---|---|
| "Needs you" tiers | USWDS alert hierarchy; Novu inbox rows | CC0; MIT |
| Worker footer toolbar | Ionic footer toolbar | MIT |
| Details stacked on phones | GOV.UK summary list | MIT |
| Customer "Next visit / Owes" | Medusa order summary; Crater amount due | MIT; AGPL (idea only) |
| Width-aware timeline blocks, command menu, side panel, undo after assigning | react-calendar-timeline, cmdk, kbar, Supabase Studio, react-admin, Sonner | MIT / Apache-2.0 |

Shortlist for later: approvals inbox in three panes (Chatwoot), a vertical workflow builder with run
traces (Activepieces), sidebar counters (Primer, shadcn/ui), virtualized timeline lanes (TanStack
Virtual), 12-step status colour scales (Radix Colors), an offline "waiting to upload" counter
(StreetComplete, idea only), a "today at a glance" tracker (Tremor). Recheck each licence before
reusing code.

## Where it lives in code

Tokens: `src/client/styles.css`. Components: `src/client/components/` (`ui.tsx`, `shell.tsx` for
the frame, navigation and command menu, `timeline.tsx`). Workspace colours:
`src/shared/branding.ts`.

## Your words → skill

How a look request becomes a design. The owner's own words always win; when a skill disagrees with
this file, follow the skill and update this file to match; write every adopted choice back here.
After editing this file, lint it: `npx -y @google/design.md@0.4.0 lint DESIGN.md`.

| When the owner says… | Use | What it does |
|---|---|---|
| "Redesign this", "make it look better" | `impeccable` (shape, then new work) + `ui-ux-pro-max` search | Plans the screen, pulls fitting styles and palettes, builds |
| "More exciting", "less plain" | `impeccable bolder` / `delight` | Personality and memorable touches |
| "Too busy", "simplify" | `impeccable quieter` / `distill` | Tones down, removes clutter |
| "Add animations", "make it feel smooth" | `impeccable animate` + `ui-ux-pro-max` motion presets | Purposeful motion and transitions |
| "Change the colours" | `impeccable colorize` + `ui-ux-pro-max` palettes | Colour proposals that keep text readable |
| "Better fonts", "the text looks off" | `impeccable typeset` + `ui-ux-pro-max` font pairings | Type hierarchy and pairings |
| "Spacing feels wrong", "messy layout" | `impeccable layout` | Spacing, rhythm, hierarchy |
| "Make it work on phones" | `impeccable adapt` | Phone, tablet and native layouts |
| "First-time experience", "empty screens" | `impeccable onboard` | Onboarding and empty states |
| "The wording is confusing" | `impeccable clarify` (or the design plugin's UX copy skill) | Labels, buttons, errors |
| "Final pass before launch" | `impeccable polish` + `audit` (or the design plugin's accessibility review) | Quality and accessibility |
| "What's wrong with this screen?" | `impeccable critique` (or the design plugin's design critique) | A scored review before changing anything |
| "Show me options" | `impeccable generate` | Several variants to choose from |
| "Show me" (pictures) | `playwright-cli` | Screenshots of a local build, phone and desktop |
| The landing page | `design-taste-frontend` | Marketing pages only, not app screens |
| Check this file | `design-md` | Lints tokens, references and contrast |

`impeccable`, `ui-ux-pro-max`, `playwright-cli`, `design-taste-frontend` and `design-md` are in
`.claude/skills/`. The design plugin skills (accessibility review, design critique, UX copy) come
from a plugin, not the repository: use them when the session has them.
