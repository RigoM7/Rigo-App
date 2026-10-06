# Working on Rigo

## How the owner wants Claude to work
- Do the task directly. Don't present plans or step-by-step instructions for the
  owner to follow; take over and do it, including setup in connected services.
- The only thing to confirm first is merging a pull request into `main`.
- Vercel deployments are limited: batch related changes into one branch and one
  pull request, push once when the work is done, and avoid extra pushes.
- Only stop to ask when a decision is genuinely the owner's, or when access or a
  safety check blocks the work.

## Project
- Live site: https://rigo-app-dun.vercel.app (Vercel project `rigo-app`, team `rigo9`).
- The app was rebuilt from scratch (React + Hono + PostgreSQL, TypeScript). Start
  with `README.md`; product rules are in `docs/PRODUCT-VISION.md`, UI rules in
  `docs/DESIGN-SYSTEM.md` and `docs/UI-GUI-PROMPT.md`. Keep
  `docs/IMPLEMENTATION-STATUS.md` honest and in sync with every change.
- Data: Supabase project `rigo-app` (`dlksigvhqxpoqarpltev`), schema `rigo` only,
  accessed by the `rigo_app` login through `DATABASE_URL` (Vercel env). Schema
  changes are new files in `migrations/` (never edit an applied one). The old
  `public.rigo_*` tables belong to the previous app and are unused.
- Every company-owned query is scoped by `company_id` and checked with the
  permission helpers in `src/server/http/context.ts`; financial and contact fields
  are removed server-side, not hidden in the UI.
- Business rules (pricing math, job states, workflow validation) live in
  `src/shared/`; external services go through `src/server/adapters/` and stay
  disabled/simulated unless configured. Demo companies never reach a provider.
- Checks: `npm run typecheck`, `npm test` (PGlite; set `DATABASE_URL` to run on
  PostgreSQL), and browser checks: `npm run build && npm start &` then
  `NODE_PATH=$(npm root -g) npm run test:browser` (uses `/opt/pw-browsers`).
- Commits that only touch `.claude/` or this file skip Vercel builds
  (`ignoreCommand`). On branches other than `main`, a commit whose first line
  contains `[checkpoint]` is also skipped; use it for work-in-progress pushes.
  `main` always builds (squash merges carry checkpoint lines in their body).

## Skills
- `.claude/skills/ui-ux-pro-max`: third-party UI/UX design skill (MIT, from
  nextlevelbuilder/ui-ux-pro-max-skill v2.13.0). Use it for UI design work.
