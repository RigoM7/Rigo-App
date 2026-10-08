# The rebuild: where it stands

Rigo is being rebuilt from scratch for any business on the branch `claude/jolly-archimedes-9cikt9`,
with one draft pull request. The plan the owner approved: https://claude.ai/artifact/1sRwW7AVGgKEufDRcsWu8e.
A new session told "continue the rebuild" reads this file first, then `CLAUDE.md`.

Rules while it runs: every push starts with `[checkpoint]`; no progress updates or preview links to
the owner until the whole rebuild is ready to launch (or truly blocked); never merge without the
owner's "launch"; migrations 020–024 are new and only add.

## Steps

| Step | State | Notes |
|---|---|---|
| 1. Foundation: workspace model, four docs | Done | Words, record types and fields, stages with meanings, owner-built roles; kept accounts, invitations and isolation code and their tests. `test/workspace-model.test.ts`, `test/team.test.ts`. |
| 2. New look and the five-place menu | Done | Tokens in `src/client/styles.css` = `DESIGN.md` (linted). Self-hosted fonts. Office shell (sidebar / bottom bar), worker shell, search (⌘K), demo ribbon, paused banner. |
| 3. Sign-up and the first five minutes | Done | `/start`: name + one sentence → word matching (`src/shared/templates.ts`) → review words, stages, roles → invite or skip → Today with the setup checklist. |
| 4. Work and schedule, then customers | Done | List, stages board, calendar (agenda on phones), day timeline by person or equipment; customer pages lead with next visit and owes. |
| 5. Worker phone app, offline | Done | Today / Upcoming / Done; one main action (start, finish); offline records with submission ids (`worker_submissions`); browser check covers going offline and back. |
| 6. Invoices and payments | Done | From finished work, exact totals, holds (missing price, quantity or tax), approve, issue, void, payments, owed by age, prices and invoice settings. |
| 7. Assisted automation and the inbox | Done | Three automations with Off/Manual/Assisted/Automatic, workspace level (safest wins), pause with held items, take over, approvals inbox, honest message states. |
| 8. Booking pages, templates, library | Done | Public `/book/:slug` (request or pick a time), requests in the inbox, four launch templates + general, the shared library (`/templates`, Settings, Templates). |
| 9. Landing page and demos | Done | Front page in the seven agreed sections; demos of any template, empty until "Show sample data", "See it as a worker". |
| 10. Full check of every screen | In progress | Automated: `e2e/run.mjs` passes on every screen at 375/768/1024/1440 px in both themes with axe, plus the flows. Still to do: see "Next" below. |

## Next (for the next session)

1. Push and let GitHub run CI on the branch; fix anything red.
2. A manual pass of each screen against `DESIGN.md` and the rule "one main action, most important
   first, nothing the person can't use" (use `impeccable critique`/`polish` where it helps), at phone
   and desktop widths, both themes. Known small items:
   - Work detail: the stage card's "Or move to" select sits beside the main button; check it on phones.
   - Long workspace names truncate in the sidebar switcher (by design); check the phone top bar.
   - The calendar month view hides on phones in favour of the agenda; confirm it reads well.
3. Run `/security-review` on the branch (sign-in, permissions and customer data all changed).
4. Then stop and ask the owner to launch. At launch: apply migrations 020–024 to Supabase, then ask
   the owner once more before wiping the old live data (accounts, workspaces and the old tables in
   README.md, "Old tables"); the clean-up migration that drops old tables is written then, with the
   owner's yes.

## Decisions taken during the rebuild (also in PRODUCT.md)

- Errors use Clay (a muted rust), never as a brand colour: the palette has no red.
- A demo needs an account; each demo is the visitor's own workspace, replaced when they open another.
- Old features not in the first version (recurring work, rentals, photos and signatures, imports,
  customer merge, workspace branding, Spanish, the workflow builder, delegation) are listed in
  PRODUCT.md "Not yet"; their tests went with them. Kept-behaviour tests were carried over:
  `test/accounts.test.ts`, `test/access.test.ts`, `test/team.test.ts` (invitations, roles, removed
  members), `test/money-math.test.ts` (rounding, holds, rates), `test/drafts.test.ts`.
- The old tables stay, unused, until the owner approves the clean-up at launch.

## How to look at it locally

```bash
npm run build && RIGO_DATA_DIR=memory PORT=8790 APP_URL=http://localhost:8790 npm start
BASE_URL=http://localhost:8790 NODE_PATH=$(npm root -g) npm run test:browser    # E2E_ONLY=screens etc.
```
The server reads `dist/index.html` when it starts: restart it after every build.
