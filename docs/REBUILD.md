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
| 10. Full check of every screen | Done | `e2e/run.mjs` passes on every screen at 375/768/1024/1440 px in both themes with axe, plus the flows. Security review done and fixed (below). Manual pass: stage controls aligned on Work detail; long names truncate in the switcher. |

## Security review (step 10)

Two reviews of the branch (sign-in and public pages; workspace data and roles). Fixed, each with a test:
- Customer messages are office-only: phone-app roles can't list, write or send them.
- Amounts stay with people who see money: payment reminders and prepared invoices are hidden from
  approvers without money access in the inbox, the automation activity and notifications.
- Nobody but an owner gives a role that can do more than their own (inviting, resending, changing a
  member); nobody but an owner changes their own role; moving a role to the phone app drops what it
  can't use.
- Phone-app roles with money access reach only invoices for their own work, never workspace totals.
- Every sign-up attempt counts toward the per-address limit (no testing addresses one after another).
- Demos can't be joined by invitation; only the demo's visitor switches its view; the test mailbox is
  never served in production; ids that aren't ids are "not found".
Left as is: `/api/cron/tick` runs without `CRON_SECRET` when none is set (harmless: reminders are
deduplicated). Setting `CRON_SECRET` in Vercel is an owner-only key, suggested at launch.

## Next

Stop and ask the owner to launch. At launch: apply migrations 020–024 to Supabase, then ask the owner
once more before wiping the old live data (accounts, workspaces and the old tables in README.md, "Old
tables"); the clean-up migration that drops old tables is written then, with the owner's yes.

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
