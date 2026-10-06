# PR #12: Redesign every screen as the "Light command center" UI

https://github.com/RigoM7/Rigo-App/pull/12 · state: closed · merged: 2026-10-06T12:59:02Z

## What

A from-scratch visual and interaction redesign of every Rigo screen, following the owner's UI/GUI prompt. Features, routes, API calls, permission checks and business rules are unchanged: no files in `src/server/`, `src/shared/` or `migrations/` were touched.

**Foundation**
- Three-layer tokens (primitive → semantic → component) for Light (default), Dark and System, all in `src/client/styles.css`. Red/white/black palette with a near-black chrome; bright red `#EF4444` is used only for indicators (the now line, live dots, the active-nav marker).
- Geist and Geist Mono, self-hosted with Fontsource (Poppins and Open Sans removed). Mono is used for data only: job numbers, quantities, money and times.
- Text selection, caret, scrollbars and focus rings are themed. Motion is CSS-only and turns off under reduced motion.

**Shell**
- Black top bar: wordmark, company switcher with the company chip, Ctrl/⌘K search, role badge, Assistant, bell and account menu.
- Black sidebar grouped Operations / People & places / Fleet / Money / Communication / Rigo / Setup. It collapses to icons and remembers the choice.
- **Command menu (Ctrl/⌘K)**: jump to screens; find jobs, customers and invoices; quick actions. Results are filtered by permission and the server checks again.
- Phones: black bottom nav with at most five items.

**Home: live dispatch timeline (the signature element)**
- Driver lanes with an Unassigned lane on top, a moving red now line, and status-coded job blocks.
- Clicking a block opens a job side panel with assignment by select.
- Feed view, day navigation and service/driver filters, all kept in the URL.
- A compact "Needs you" strip where each item has a visible action button, plus "What Rigo is doing" and "Last 30 days".

**Screens**
- Jobs: Table, Board and Timeline views, bulk driver assignment with a black action bar.
- Job detail: new record header and history timeline.
- Driver phone screens: mono time and quantities.
- Invoices: list grouped by work state; separate invoice/approval/delivery/payment/total cells; restyled document.
- Inbox: consequence table for approve, reject and edit.
- Automation: live run indicators.
- Assistant: full screen with suggestions, answer labels and prefilled "Ask Rigo" chips.
- Also: centered auth card; workspaces with company chips; branding live preview in Settings; branded email preview in Messages; new 404 and not-a-member pages.

**Docs**: `docs/DESIGN-SYSTEM.md` and `docs/UI-GUI-PROMPT.md` are rewritten to describe the new design, with measured contrast for every pair. `docs/IMPLEMENTATION-STATUS.md` and `README.md` are updated, including the limits listed below.

## Before → after

| | Before (main) | After |
|---|---|---|
| Home, light | ![](https://github.com/RigoM7/Rigo-App/blob/42a5b14e28652a524dce9b71da831223676f67a7/docs/screenshots/demo-home-1440-light.png?raw=true) | ![](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/demo-home-1440-light.png?raw=true) |
| Home, dark | ![](https://github.com/RigoM7/Rigo-App/blob/42a5b14e28652a524dce9b71da831223676f67a7/docs/screenshots/demo-home-1440-dark.png?raw=true) | ![](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/demo-home-1440-dark.png?raw=true) |
| Invoice | ![](https://github.com/RigoM7/Rigo-App/blob/42a5b14e28652a524dce9b71da831223676f67a7/docs/screenshots/invoice.png?raw=true) | ![](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/invoice.png?raw=true) |
| Driver job (390px) | ![](https://github.com/RigoM7/Rigo-App/blob/42a5b14e28652a524dce9b71da831223676f67a7/docs/screenshots/driver-job-390.png?raw=true) | ![](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/driver-job-390.png?raw=true) |

New: [command menu](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/command-menu.png?raw=true) · [timeline feed view](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/home-feed-1440.png?raw=true) · [Home on a phone](https://github.com/RigoM7/Rigo-App/blob/f60c528/docs/screenshots/demo-home-390.png?raw=true)

## How it was checked

- `npm run typecheck`: clean.
- `npm test`: 37/37 on embedded PostgreSQL (PGlite). Not re-run on PostgreSQL 16 because no server code changed.
- `e2e/run.mjs`: **27/27**, with three new checks: the timeline (lanes, now line, side panel, feed), the command menu, and sidebar collapse. Axe found 0 violations on 18 pages in light and dark; no horizontal overflow at 375/768/1024/1440px or at 200% text; reduced motion; skip link; no console errors.

## Known limits (also in the status doc)

- A job moving to another driver's lane appears there without a transition, and table rows don't animate. Blocks do slide when a job's time changes.
- Reassigning on the timeline is by select; drag-to-reassign is not built.
- The feed view lists the day's jobs only; it doesn't yet include other events such as messages or automation steps.
- Customer emails are still plain text because no email provider is set up; the branded layout is the in-app preview.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_011ZHmQ9qrC8czZJ5a29ZJvg

---
_Generated by [Claude Code](https://claude.ai/code/session_011ZHmQ9qrC8czZJ5a29ZJvg)_
