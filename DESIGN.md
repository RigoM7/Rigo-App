---
version: alpha
name: Rigo — Calm, bold, friendly
description: >-
  Rigo's look for any business: a light, roomy workspace with one strong green (Spruce), a warm
  yellow for what needs attention (Marigold), rounded shapes and a confident headline face. Light
  theme values here; the dark theme is in the Colors section. Values match src/client/styles.css.
colors:
  primary: "#0E7A64"
  primary-hover: "#0B6553"
  on-primary: "#FFFFFF"
  primary-soft: "#E3F1EC"
  primary-text: "#0B6B58"
  attention: "#F2B53A"
  attention-soft: "#FDF3DE"
  attention-ink: "#6B4A00"
  clay: "#A8402A"
  clay-soft: "#FBEAE5"
  background: "#F5F7F4"
  surface: "#FFFFFF"
  surface-2: "#EDF1EC"
  surface-3: "#E2E8E3"
  text: "#15201C"
  text-2: "#4A5751"
  line: "#DDE3DE"
  line-strong: "#7D8A84"
  demo-ink: "#2A1E00"
typography:
  display:
    fontFamily: Bricolage Grotesque
    fontSize: 64px
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: -0.035em
  headline-lg:
    fontFamily: Bricolage Grotesque
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Bricolage Grotesque
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.015em
  title:
    fontFamily: Bricolage Grotesque
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
  body-md:
    fontFamily: Figtree
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Figtree
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Figtree
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: Figtree
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
  data:
    fontFamily: JetBrains Mono
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: '"tnum"'
rounded:
  control: 12px
  card: 14px
  dialog: 18px
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
    rounded: "{rounded.control}"
    height: 44px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: 44px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.clay}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    height: 44px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: 20px
  card-tint:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
  muted-on-page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text-2}"
  nav-current:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-text}"
  stage-open:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  stage-active:
    backgroundColor: "{colors.attention-soft}"
    textColor: "{colors.attention-ink}"
  stage-finished:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-text}"
  stage-failed:
    backgroundColor: "{colors.clay-soft}"
    textColor: "{colors.clay}"
  demo-ribbon:
    backgroundColor: "{colors.attention}"
    textColor: "{colors.demo-ink}"
  toast:
    backgroundColor: "{colors.text}"
    textColor: "{colors.background}"
    rounded: "{rounded.card}"
  wash:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
---

# Rigo design

How Rigo looks, moves and feels, and which design skills turn the owner's words into a design. The
tokens above follow Google's DESIGN.md format (`.claude/skills/design-md`) and match
`src/client/styles.css`, which holds the real values. To change the look, find the request in
"Your words → skill" at the end.

## Overview

**Calm, bold, friendly.** Rigo is for any business: a salon owner on a phone between clients, a
bakery planning tomorrow's orders, a fuel dispatcher at a desk. It should feel like a tidy, sunny
workshop: light and roomy, one strong green that says "go", a warm yellow that says "look here",
rounded shapes, and a headline face with personality. Never cold, never busy.

- **One main action per screen**, in Spruce, where the eye lands first. Everything else is quieter.
- **The most important thing first**: what needs a person, then today, then the rest.
- **The workspace's own words everywhere**: "Appointments" in a salon, "Orders" in a bakery.
- **Avoided:** red and black (the earlier look), gradients, rows of identical icon cards, stock
  illustrations, emoji as icons, actions hidden on hover or behind "…".

## Colors

Three layers: raw values (only in the two theme blocks of `styles.css`), semantic tokens (meaning,
redefined per theme) and component tokens. Components use semantic tokens only. The printed invoice
always renders on white, because that is what the customer receives.

- **Spruce** (`primary` #0E7A64; dark theme #3CC4A2): main buttons, the current place in the menu,
  links (`primary-text`), finished states. White text on it is 5.3:1; in the dark theme the text on
  it is #0B1512 (8.5:1).
- **Marigold** (`attention` #F2B53A): what needs a look: active work, held invoices, counts, the
  demo ribbon, the timeline's "now" line. Never as text on light backgrounds; its text partner on the
  soft tint is `attention-ink` #6B4A00 (7.3:1).
- **Clay** (`clay` #A8402A; dark #F0957D): errors and destructive actions only, always with an icon
  and a verb ("Void invoice"). Never a brand colour.
- **Neutrals:** background #F5F7F4 ("Morning"), surfaces #FFFFFF / #EDF1EC / #E2E8E3, text #15201C
  and #4A5751, lines #DDE3DE, control edges #7D8A84 (3.6:1 on white).
- **Dark theme:** background #0F1513, surfaces #17201D / #1D2824 / #25322D, text #EEF3F0 and
  #A7B4AE, lines #2A3631, control edges #6F7F78, Spruce #3CC4A2 with soft #13302A, Marigold soft
  #33290F with ink #F6CD74, Clay #F0957D on #3A1E17.
- **Stages** always show an icon plus the workspace's own stage name: Open (outline), Active
  (Marigold), Finished (Spruce), Cancelled (muted outline), Failed (Clay).
- **Themes:** Light (default), Dark and "Same as this device", saved to the account and the device
  and applied before first paint.

## Typography

- **Bricolage Grotesque** for headings: bold (700–800), tight tracking, balanced lines. The front
  page's hero goes up to 68px.
- **Figtree** for everything else: 16px base, 1.5 line height, 600 for labels and buttons. Inputs are
  16px so phones never zoom.
- **JetBrains Mono** for money, numbers, times and record numbers, with tabular figures.
- All three are self-hosted with `@fontsource-variable` packages (no font service; they work offline).
  Only the Latin files are preloaded.

## Layout

- 4px spacing scale; generous space between groups, tight inside them. Prose stays under 68
  characters.
- **Office, 1024px and wider:** a white sidebar with the workspace switcher, search (⌘K) and five
  places (Today, the workspace's word for work, its word for customers, Money, Settings) plus the
  inbox with a Marigold count. Content up to 1180px.
- **Office, phones and tablets:** a top bar (workspace, search, inbox) and a bottom bar with the
  same five places. Tables become labelled rows below 768px. No sideways scrolling at any width.
- **Worker phone app:** a top bar with the sync state, one column up to 640px, a bottom bar with
  Today, Upcoming and Done, and the one main action fixed above it.
- **Public pages** (front page, sign-in, booking): the wordmark top-left, a single centred column for
  forms.

## Elevation & Depth

Flat surfaces separated by tone and 1px lines. Shadows only for things that float: dialogs, menus,
search, toasts and the front page's product mock-ups, always soft and offset downwards.

## Shapes

Rounded and friendly: 12px on buttons and inputs, 14px on cards, 18px on dialogs, full rounding on
badges and counts. The stages board, the calendar and the timeline use the same radii.

## Components

The kit is `src/client/components/ui.tsx` (buttons, fields, badges, banners, dialogs, menus, toasts,
empty and error states), `shell.tsx` (the frames, search, demo ribbon) and `fields.tsx` (custom-field
inputs).

- **Button:** 44px tall (36px small, still 44px on touch screens); primary (Spruce), default
  (outlined), ghost, danger (Clay outline). States: hover, focus, pressed, disabled, busy (spinner).
- **Field:** a visible label above, "(optional)" when it is, a hint, an inline error with an icon.
  A failed form shows a focused summary at the top.
- **Badge:** icon plus text, never colour alone. Stage badges use the stage's meaning.
- **Banner:** info (Spruce tint), attention (Marigold tint), error (Clay tint), plain.
- **Dialog:** for confirmations and short forms; says the consequence in plain words; traps focus;
  Escape closes it.
- **Every screen:** loading (skeletons), empty (with the next action), error (with retry), permission
  ("not for your role"), offline and stale states.
- **Patterns:** *Today* leads with the setup checklist and what's waiting, then the day's work, then
  money. *Customer page* leads with Next visit and Owes. *Timeline:* a lane per person (or per piece
  of equipment), blocks sized by their time, the Marigold "now" line; clicking a block opens it.
  *Worker item:* the address first, Directions and Call, then one full-width action at the bottom.
  *Inbox:* each item says what Rigo prepared and offers Approve, Reject and Take over.

## Do's and Don'ts

- Do use the workspace's words, semantic tokens and the existing components.
- Do show status as icon plus text, and name actions with verbs.
- Do keep every flow usable with selects and buttons; dragging is never required.
- Don't fake success, progress or data; label anything simulated or demo.
- Don't put Marigold text on a light background, or use Clay for anything but errors and danger.

## Motion

Motion explains what changed. 120ms for hover and press, 200ms for dialogs, menus and toasts
(rising slightly as they appear), with `cubic-bezier(0.16, 1, 0.3, 1)`. CSS only. With reduced
motion, every duration is zero and skeletons stop shimmering.

## Accessibility floor

Kept whatever the direction. WCAG 2.2 AA in both themes: text at least 4.5:1, large text and control
edges at least 3:1; a visible 3px focus outline; a skip link; accessible names that contain the
visible label; nothing by colour alone; 44px tap targets; no sideways scrolling at 375, 768, 1024 and
1440px or at 200% text; reduced motion honoured; everything usable with a keyboard. `e2e/run.mjs`
checks these with axe on every pull request; screen-reader walkthroughs are still manual.

## Phones and native apps

Phone-first layouts at 375px, one-handed use for workers. Today Rigo installs from the browser
(manifest, icons, a service worker that keeps the app shell offline). Native apps, when built, follow
each platform's conventions.

## Research and licences

Visual ideas can come from open-source projects. Rigo has no open licence, so copy or adapt code or
assets only from MIT, Apache-2.0, BSD, ISC or CC0 projects, keep their notices and list them in
`THIRD_PARTY_NOTICES.md`; GPL, AGPL, LGPL, SSPL, Elastic, BSL and custom licences are for ideas only.
The fonts are under the SIL Open Font License (listed there).

## Your words → skill

How a look request becomes a design. The owner's words always win; when a skill disagrees with this
file, follow the skill and update this file. After editing this file, lint it:
`npx -y @google/design.md@0.4.0 lint DESIGN.md`.

| When the owner says… | Use | What it does |
|---|---|---|
| "Redesign this", "make it look better" | `impeccable` (shape, then new work) + `ui-ux-pro-max` search | Plans the screen, pulls fitting styles, builds |
| "More exciting", "less plain" | `impeccable bolder` / `delight` | Personality and memorable touches |
| "Too busy", "simplify" | `impeccable quieter` / `distill` | Tones down, removes clutter |
| "Add animations" | `impeccable animate` | Purposeful motion |
| "Change the colours" | `impeccable colorize` + `ui-ux-pro-max` palettes | Colours that keep text readable |
| "Better fonts" | `impeccable typeset` + `ui-ux-pro-max` font pairings | Type hierarchy and pairings |
| "Spacing feels wrong" | `impeccable layout` | Spacing, rhythm, hierarchy |
| "Make it work on phones" | `impeccable adapt` | Phone, tablet and native layouts |
| "First-time experience", "empty screens" | `impeccable onboard` | Onboarding and empty states |
| "The wording is confusing" | `impeccable clarify` (or the design plugin's UX copy skill) | Labels, buttons, errors |
| "Final pass before launch" | `impeccable polish` + `audit` | Quality and accessibility |
| "What's wrong with this screen?" | `impeccable critique` | A scored review before changing anything |
| "Show me" (pictures) | `playwright-cli` | Screenshots of a local build |
| The front page | `design-taste-frontend` | Marketing pages only |
| Check this file | `design-md` | Lints tokens, references and contrast |
