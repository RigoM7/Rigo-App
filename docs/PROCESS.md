# How changes are made

Rigo changes go through two skills: `/change` builds and shows a change, `/release` publishes it.
Read only the headings a task needs.

## The flow
1. The owner sends what to change (text, a picture or both) with `/change <what>`.
2. `/change` finds the area in `docs/AREAS.md`, builds the change, checks it locally and sends
   before and after screenshots. The owner adjusts in plain words until they approve.
3. `/release` pushes once, opens a draft PR with the checklist and gives the preview link.
4. The owner says "merge". `/release merge` turns on auto-merge once checks are green.
5. "Undo the last change" opens a revert PR. "What's open?" lists open PRs. "Cancel" closes a
   draft and deletes its branch after one confirmation.

## Working with the owner
- Do the task directly, including setup in connected services. Don't hand the owner steps they
  could have had done for them.
- The only thing confirmed first is merging into `main`, plus everything under "Stop and ask".
- Vercel deployments are limited: one branch and one PR per batch of work, one push when done.
- When the owner names no area, pick one and say which. When a decision is sensible and not the
  owner's, make it and list it in the PR under "Decisions".

## Stop and ask
Stop and ask before building when a change touches:
- money, tax or pricing rules;
- permissions (who may see or do what);
- deleting or rewriting live data, or a migration that changes existing data;
- anything that sends messages or costs money;
- a new package or outside service;
- a conflict with `docs/PRODUCT-VISION.md`.

A departure from `docs/DESIGN-SYSTEM.md` doesn't stop the work: do it and note it in the PR.

## Building rules
### Data and permissions
- Every company-owned query is scoped by `company_id` and checked with the permission helpers in
  `src/server/http/context.ts`. Non-members get 404; one company's data never shows in another.
- Financial and contact fields are removed on the server, never just hidden in the UI.
### Money
- Business rules (pricing math, job states, workflow validation) live in `src/shared/`.
- Money uses exact decimal arithmetic in minor units. A missing rate holds an invoice; it is never
  priced at 0. AI never computes prices, taxes or totals.
### Honest states
- Nothing claims a send, sync, payment or approval that didn't happen. Simulated and demo output
  is labeled. Timeouts never approve.
### Outside services
- External services go through `src/server/adapters/` and stay disabled or simulated until
  configured. Demo companies never reach a provider.
### Screens
- Use the tokens in `src/client/styles.css` and the components in `src/client/components/`; add
  one only when nothing fits. `docs/DESIGN-SYSTEM.md` and `docs/UI-GUI-PROMPT.md` are the rules for
  new or redesigned screens. No new colors, fonts or icon sets.
- Real data only. Loading, empty (with a next action), error (with retry), permission-denied and,
  where it applies, offline states. Unavailable features are labeled, never silently inert.
- Status is icon plus text, never color alone. Forms have visible labels and inline errors.
- Works at 375, 768, 1024 and 1440 px with no horizontal page scroll, in light and dark themes, at
  200% text and with the keyboard only. Operational actions are at least 44px tall.
- Design skills (`ui-ux-pro-max`, `impeccable`, `playwright-cli`) are for new or redesigned
  screens only. Rigo's confirmed palette and `docs/DESIGN-SYSTEM.md` win over any skill.
### Visual research and licences
- Visual work (look, screens, components, design system) starts by researching open-source
  projects on GitHub with 1,000+ stars related to what Rigo does (field service, dispatch and
  scheduling timelines, fleet and driver apps, invoicing and billing, CRM, dashboards and design
  systems), and builds on their work.
- Rigo has no open license. Copy or adapt code only from MIT, Apache-2.0, BSD or ISC projects, keep
  their copyright notices and list them in `THIRD_PARTY_NOTICES.md`. GPL, AGPL, LGPL, SSPL,
  Elastic, BSL and unlicensed projects are for ideas and patterns only, never copied code or
  assets.
- Record what was used, from where and why in `docs/DESIGN-RESEARCH.md`.

## Tests
- Every change adds or extends a test in `test/` that includes a permission or isolation case.
- A bug gets a failing test first (or a browser check in `e2e/run.mjs` for a UI-only bug). Show it
  failing before the fix and passing after. Find the root cause and fix the same mistake elsewhere.
- Extend `e2e/run.mjs` when a change adds a key flow or page.
- Never skip, weaken or delete a test. After three failed attempts at the same fix, stop and
  report what was tried.

## Shared files
The automation engine, the notification helpers, invoicing and the nav bar are used by many
areas (listed at the top of `docs/AREAS.md`). After changing one, run the tests of every area
listed against it and flag it in the PR.

## Database and live data
- Supabase project `rigo-app` (`dlksigvhqxpoqarpltev`), schema `rigo` only, used by the
  `rigo_app` login through `DATABASE_URL` (Vercel env). The old `public.rigo_*` tables are unused.
- Migrations are new numbered files in `migrations/`; never edit an applied one. They only add.
  They are applied to Supabase before merge. Tables are listed in `docs/SCHEMA.md`.
- On live data, run read-only counts and summaries only.
- The `RIGO_QA_*` variables hold a QA account for the live site. Use it only with the owner's
  go-ahead in that session, only to look: never create or change data there.
- Previews and anything that writes use a demo company. Local work uses the embedded database.
- When a change stores more files or photos, say how it affects the database size.

## Checks and time
- `npm ci` takes about 9 seconds and `npm run typecheck` about 5.
- The full `npm test` suite takes about 10 minutes and runs on GitHub. Locally, run only the
  area's tests: `npx vitest run <files from docs/AREAS.md>`.
- Browser check: `npm run build && npm start &`, then `NODE_PATH=$(npm root -g) npm run
  test:browser`. It runs on GitHub when client files change.
- `npm run check:docs` checks `docs/AREAS.md` and `docs/SCHEMA.md` against the code.
- Screenshots come from the local app, so tweaks don't use Vercel deployments.

## Releasing
- One commit and one push per release. A first line with `[checkpoint]` skips the Vercel build;
  never use it on a release, so the preview builds.
- Commits that only touch docs, `.claude/`, `.github/` or `CLAUDE.md` skip Vercel builds.
- Open a draft PR from the PR template. Never merge into `main` without the owner saying "merge".
- A draft PR can't merge: mark it ready for review, then turn on auto-merge (squash). "PR check" is
  required on `main`, so auto-merge waits for it; if that rule is ever removed, confirm the checks
  are green yourself first, because auto-merge would merge at once.

## Checklist
Every PR answers each line (the PR template has the table):
1. Isolation: company-owned queries scoped by `company_id`; non-members get 404.
2. Permissions: checked on the server; financial and contact fields removed on the server.
3. Money: exact math in `src/shared/`; missing rates hold.
4. Honest states: no claimed send, sync, payment or approval that didn't happen.
5. Demo safety: demo companies never reach a provider.
6. Migrations: new files only, additive, applied before merge.
7. Screens: tokens and components; required states; four widths; both themes.
8. Tests: added, including a permission or isolation case; none skipped or weakened.
9. Docs: `docs/IMPLEMENTATION-STATUS.md`, `docs/AREAS.md` and `docs/SCHEMA.md` match the code.
10. Security review: run with `/security-review` on sign-in, permission and customer-data changes.

## Reports
- Three lines: what changed, how it was checked, what's next or blocked. Stay quiet until done or
  blocked.
- Problems noticed outside the request become suggested tasks, not part of the change.
- Check open PRs for the same area before starting, and warn about overlap.

## Sessions and models
- One task per session. Say when a fresh session would be cheaper.
- Sonnet for routine work; flag hard tasks so the owner can switch to Opus.

## First aid
- **The live site is broken after a merge:** in Vercel, promote the previous production
  deployment. Then say "undo the last change" for a revert PR.
- **The post-deploy check opened an issue:** read it; it links the revert PR it prepared.
- **The PR check failed:** say "fix the PR check"; the cause is fixed and pushed, never skipped.
- **Auto-merge didn't merge:** a check is red or the PR is still a draft; ask "what's open?".

## Owner-only actions
- Merging into `main` (say "merge").
- GitHub → Settings → Actions → General: "Read and write permissions" and "Allow GitHub Actions
  to create and approve pull requests" (Claude sessions can't change Actions settings).
- Adding secret keys in Vercel, GitHub or the cloud environment.
- Pasting workflow files through GitHub's website if a push of them is rejected.
