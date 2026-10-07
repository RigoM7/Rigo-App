# How changes to Rigo are made

`/change` builds, `/release` checks and publishes. This page holds the rules both use, once.
Read only the section you need.

## Saving tokens
- Look up the area in `docs/AREAS.md` (one section), not the whole app.
- Read a doc by heading (`grep -n` for the topic, then read that part), not in full.
- While building, run `npm run typecheck` and the area's test files (`npx vitest run test/<file>`).
  The full suite and the browser check run once, in `/release`.
- Don't re-read a file you just edited. Don't paste long logs or full tables back; report counts.
- One task per session.

## Rules (every change)
1. Company data: every company-owned query is scoped by `company_id`; non-members get 404.
2. Permissions: checked on the server with the helpers in `src/server/http/context.ts`; financial
   and contact fields are removed on the server, never just hidden in the UI.
3. Money: business rules live in `src/shared/`; exact decimal math in minor units; a missing rate
   holds an invoice, it never prices at 0; AI never computes prices, taxes or totals.
4. Honest states: nothing claims a send, sync, payment or approval that didn't happen; simulated
   and demo output is labeled; a timeout never approves.
5. External services go through `src/server/adapters/` and stay disabled or simulated unless
   configured. Demo companies never reach a provider.
6. Schema: a new numbered file in `migrations/`, never an edit to an applied one. Make it additive
   (add, don't rename or drop what live code uses), and update `docs/SCHEMA.md`.
7. Tests: new behavior gets a test in `test/`, including a permission or isolation case. A bug
   gets a failing test first, then the root-cause fix. Never skip, weaken or delete a test.
8. Docs: `docs/IMPLEMENTATION-STATUS.md` says honestly what is built, verified, simulated or deferred.

## UI changes (anything a person sees)
- Rules live in `docs/DESIGN-SYSTEM.md` and `docs/UI-GUI-PROMPT.md`; find the screen's entry and
  the relevant section by heading. The confirmed palette wins over any skill. No new colors,
  fonts or icon sets; reuse `components/` and `styles.css`.
- Real data only, no invented numbers or fake success. Loading, empty (with a next action), error
  (with retry), permission-denied and, where it applies, offline states.
- Status as icon plus text, never color alone; visible labels and inline form errors.
- Works at 375, 768, 1024 and 1440 px with no horizontal scroll, in light and dark, at 200% text,
  keyboard only. Operational actions at least 44 px tall.

## Release gate (`/release`)
Go in order, run only the lines whose "when" applies, stop at the first failure, fix, resume.

| # | Check | When |
|---|---|---|
| 1 | Diff holds only what was asked (`git diff --stat main...HEAD`) | always |
| 2 | `npm run typecheck` and `npm test` pass | always |
| 3 | Rules 1, 2, 4 and 5 hold in the diff; run `/review` | server code, money, permissions or customer data |
| 4 | Money rules (3) have tests | pricing, invoices, taxes |
| 5 | `npm run build && npm start &`, then `NODE_PATH=$(npm root -g) npm run test:browser`; screenshots at phone and desktop widths, both themes | UI |
| 6 | Migration is additive, `docs/SCHEMA.md` updated, backup need noted | `migrations/` |
| 7 | No secrets in code; new env vars or providers listed for the owner to set in Vercel | config or adapters |
| 8 | `docs/IMPLEMENTATION-STATUS.md` updated with the latest results | always |
| 9 | Push once, open or update the draft PR with this table; the preview deploy works and the changed screen loads | always |
| 10 | Owner says merge. Never merge without it | always |
| 11 | After merge: read-only check of the live site and runtime logs; note the rollback (revert the PR, or Vercel instant rollback) | always |

Apply a migration to Supabase before merging the code that needs it. Don't change live data
without the owner's go-ahead.
