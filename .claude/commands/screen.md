---
description: Design, build or redesign a Rigo screen to the design system and UI prompt
argument-hint: <the screen, and what should change>
---

Work on this Rigo screen:

$ARGUMENTS

1. Read `docs/UI-GUI-PROMPT.md` and `docs/DESIGN-SYSTEM.md` in full; they are the rules. Find
   the screen's role(s) and its entry in the screen list there.
2. Find the current page in `src/client/pages/` and the shared components and tokens in
   `src/client/components/` and `src/client/styles.css`. Reuse them; add a token or component
   only when nothing fits.
3. Use the `ui-ux-pro-max` or `impeccable` skill for design judgment if it helps, but Rigo's
   confirmed palette and `docs/DESIGN-SYSTEM.md` win over any skill's suggestion. No new
   colors, fonts or icon sets.
4. Build it with:
   - Real data only: no invented numbers, fake progress or fake success.
   - Loading, empty (with a next action), error (with retry), permission-denied and, where it
     applies, offline states.
   - Status as icon + text, never color alone; visible labels and inline errors on forms.
   - Layouts that work at 375, 768, 1024 and 1440 px with no horizontal page scroll, in light
     and dark themes, at 200% text, keyboard only.
   - Operational actions at least 44px tall.
5. If the server must change to support the screen, follow the rules in `CLAUDE.md` (company
   scoping, server-side field removal).
6. Check it in the browser: `npm run build && npm start &`, then
   `NODE_PATH=$(npm root -g) npm run test:browser`, and screenshot the screen at phone and
   desktop widths in both themes. Look at the screenshots and fix what's off.

Then run `/ship`.
