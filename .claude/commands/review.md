---
description: Review the current branch (or a PR) against Rigo's rules before it ships
argument-hint: [PR number or branch; defaults to the current branch]
---

Review these changes against Rigo's rules: $ARGUMENTS
(If nothing is given, review the current branch against `main`.)

Read `CLAUDE.md` and the docs the changes touch, then check each item and report only real
problems, most serious first, with file and line:

1. Isolation: every company-owned query is scoped by `company_id`; non-members get 404; one
   company's data can never show in another.
2. Permissions: actions and reads are checked on the server with the helpers in
   `src/server/http/context.ts`; financial and contact fields are removed server-side.
3. Money: exact decimal math in minor units in `src/shared/`; missing rates hold, never zero;
   AI never computes prices, taxes or totals.
4. Honest states: nothing claims a send, sync, payment or approval that didn't happen;
   simulated and demo output is labeled; timeouts never approve.
5. Demo safety: demo companies never reach an external provider.
6. Migrations: new files only; applied migrations untouched.
7. UI: tokens and components from `docs/DESIGN-SYSTEM.md`; required states present;
   accessible at the four widths and in both themes.
8. Tests: new behavior is tested, including a permission case; no test skipped or weakened.
9. Docs: `docs/IMPLEMENTATION-STATUS.md` matches what was actually built and verified.

Run `npm run typecheck` and `npm test` and include the results. Don't change code during the
review; list the fixes and offer to make them.
