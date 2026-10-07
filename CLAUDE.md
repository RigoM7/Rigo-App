# Working on Rigo

Rigo is a platform where any business creates a workspace and automates its work. The vision is
`PRODUCT.md`; what exists today is `docs/FEATURES.md`; how to run, check and ship the app is
`README.md`. Live site: https://rigo-app-dun.vercel.app. This file is how Claude works here.

## The owner
- Decides what Rigo does and how it looks. Not a developer; runs a field-service business, so
  product questions come from real operations. Claude makes the technical calls.
- Works from the phone or web app. Chat is short and technical, with a plain-English line when a
  decision is theirs.
- Every task ends with one summary: what changed, what was picked where it was ambiguous, the docs
  read and updated, check results (failures stated plainly) and the pull request link.

## How to work
- Do the task directly, including setup in connected services. Never hand the owner steps.
- Ambiguous but not dangerous: pick the sensible option, build it, say what was picked.
- If an idea seems wrong, say so in a line or two with a recommendation, then follow the owner.
- Small problems nearby: fix them. Big ones: mention them, don't touch them.
- When checks fail, keep trying different approaches until they pass. Stop only when the cause is
  outside the code (missing access, a service down, a product decision) and say what's needed.
- The only approval needed is launching (merging into `main`).
- Connected tools are for Rigo work only: Supabase, Vercel and GitHub for the app; Figma and Canva
  for design. Never Gmail, Calendar or Drive unless asked.
- Screenshots only when the owner asks.

## Which docs to read
| Request | Read |
|---|---|
| A new or changed feature | `PRODUCT.md` → `docs/FEATURES.md` (the area) → `docs/CODEMAP.md` (the area) |
| How it looks | `DESIGN.md` (its "Your words → skill" table) → `docs/FEATURES.md` (what must keep working) → `docs/CODEMAP.md` |
| A bug | `docs/FEATURES.md` (what should happen) → `docs/CODEMAP.md` |
| Run, check or ship | `README.md` |

`PRODUCT.md` is the goal, not what exists: check `docs/FEATURES.md` before assuming anything is
built. Read only the sections a task needs.

## The owner's words
- **"Show me":** push the branch without `[checkpoint]` (migrations held back) and send the preview
  link.
- **"Launch":** run all checks, apply any held migrations to Supabase, mark the pull request ready
  and merge it into `main`, confirm the live site.
- **"Status":** list what's on the branch and not launched.
- **"Cancel X":** take that change off the branch.
- **"Undo":** revert the last launch with a revert pull request and merge it.

Work collects on one branch with one draft pull request; pushes in between start with
`[checkpoint]`. Mechanics are in `README.md`, "Shipping to the live site".

## Rules that never bend
- Every company-owned query is scoped by `company_id` and checked with the helpers in
  `src/server/http/context.ts`; non-members get 404. Financial and contact fields are removed on
  the server, never just hidden in the UI.
- Business rules live in `src/shared/`. Money is exact, in minor units; a missing price holds an
  invoice; AI never computes prices, taxes or totals.
- Honest states: nothing claims a send, sync, payment or approval that didn't happen. Timeouts never
  approve.
- External services go through `src/server/adapters/` and stay disabled or simulated until
  configured. Demo workspaces never reach a provider.
- Migrations are new numbered files that only add; never edit one already on `main`. They stay out
  of preview pushes (previews share the live database) and are applied at launch.
- Live data: read-only counts and summaries only. The QA account (`RIGO_QA_*` variables) only with
  the owner's go-ahead in that session, and only to look.

## Tests
- Every change adds or extends a test, including a permission or isolation case.
- A bug gets a failing test first, then the fix; fix the same mistake elsewhere too.
- Never skip, weaken or delete a test.
- Sign-in, permission and customer-data changes get `/security-review` before shipping.
- Locally: `npm run typecheck` and the area's tests (`npx vitest run <files>` from
  `docs/CODEMAP.md`). The full suite and the browser check run on GitHub for every pull request.

## Keep the docs true
| What changed | Update |
|---|---|
| What the app does | `docs/FEATURES.md` (and its gap list) |
| Files, tests or tables | `docs/CODEMAP.md`; `npm run check:docs` must pass |
| How it looks | `DESIGN.md` (lint it as it says) |
| A product decision | `PRODUCT.md`, Decisions |
| How it runs or ships | `README.md` |
| How the owner wants Claude to work | this file |

## First aid
- **The live site broke after a launch:** in Vercel, promote the previous production deployment,
  then "undo".
- **The post-deploy check opened an issue:** read it; it links the revert pull request it prepared.
- **A pull request check failed:** fix the cause and push; never skip it.

## Owner-only
- Approving a launch.
- GitHub Actions permissions, and secret keys in Vercel, GitHub or the cloud environment.
- The permission mode. `.claude/settings.json` allows the routine commands and blocks force pushes,
  `git reset --hard` and pushes to `main`; `.claude/hooks/protect-migrations.sh` blocks editing a
  migration already on `main`; `.claude/hooks/session-start.sh` installs packages. Its
  `defaultMode` has no effect in a repository: the owner sets the mode in their own session.
