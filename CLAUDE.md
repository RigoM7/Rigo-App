# Working on Rigo

## How the owner wants Claude to work
- Do the task directly. Don't present plans or step-by-step instructions for the
  owner to follow; take over and do it, including setup in connected services.
- The only thing to confirm first is merging a pull request into `main`.
- Vercel deployments are limited: batch related changes into one branch and one
  pull request, push once when the work is done, and avoid extra pushes.
- Only stop to ask when a decision is genuinely the owner's, or when access or a
  safety check blocks the work.
- Keep token use low: read only the docs the task needs (table below), search for the
  specific code instead of reading whole directories, and don't re-read files you just
  edited. Routine work suits Sonnet; the owner switches to Opus for hard design or debugging.

## Which doc to read
| Task | Read |
|---|---|
| Anything touching the database | `docs/SCHEMA.md`, then the relevant file in `migrations/` |
| Product rules, pricing, job states, workflows | `docs/PRODUCT-VISION.md` |
| UI, screens, styling | `docs/DESIGN-SYSTEM.md`, then `docs/UI-GUI-PROMPT.md` |
| What is built, verified or deferred | `docs/IMPLEMENTATION-STATUS.md` (keep it in sync with every change) |
| Setup, scripts, layout | `README.md` |

## Project
- Live site: https://rigo-app-dun.vercel.app (Vercel project `rigo-app`, team `rigo9`).
- React + Hono + PostgreSQL, TypeScript, rebuilt from scratch.
- Data: Supabase project `rigo-app` (`dlksigvhqxpoqarpltev`), schema `rigo` only,
  accessed by the `rigo_app` login through `DATABASE_URL` (Vercel env). Schema
  changes are new files in `migrations/` (never edit an applied one) and update
  `docs/SCHEMA.md`. The old `public.rigo_*` tables belong to the previous app and are unused.
- Every company-owned query is scoped by `company_id` and checked with the
  permission helpers in `src/server/http/context.ts`; financial and contact fields
  are removed server-side, not hidden in the UI.
- Business rules (pricing math, job states, workflow validation) live in
  `src/shared/`; external services go through `src/server/adapters/` and stay
  disabled/simulated unless configured. Demo companies never reach a provider.
- Photos and signatures are stored in the database (`rigo.files`) on Vercel; if file
  volume grows, move them behind `storeFile` in `src/server/adapters/index.ts` to file storage.
- Checks: `npm run typecheck`, `npm test` (PGlite; set `DATABASE_URL` to run on
  PostgreSQL), and browser checks: `npm run build && npm start &` then
  `NODE_PATH=$(npm root -g) npm run test:browser` (uses `/opt/pw-browsers`).
- Commits that only touch `.claude/` or this file skip Vercel builds
  (`ignoreCommand`). On branches other than `main`, a commit whose first line
  contains `[checkpoint]` is also skipped; use it for work-in-progress and docs-only pushes.
  `main` always builds (squash merges carry checkpoint lines in their body).
- `.claude/settings.json` allows the routine commands (npm installs and scripts, the
  checks above, Playwright, everyday git) without a prompt, and denies force pushes
  and `git reset --hard`. Add to that list when the owner approves a new command.
  Its `defaultMode: bypassPermissions` has no effect (Claude Code ignores it in a
  repository's settings); only the owner changes the permission mode.

## Prompts
The owner's reusable prompts live in `.claude/commands/`; each runs as `/<name>`. Write new
ones with `/new-prompt`. Changes that only touch `.claude/` and this file don't trigger a build.
- `/new-prompt <idea>`: turn an idea into a new prompt in this library.
- `/feature <feature>`: build a feature end to end (server, client, tests, docs).
- `/screen <screen and change>`: design, build or redesign a screen to the design system.
- `/fix <bug>`: reproduce a bug with a test, fix the root cause.
- `/review [PR or branch]`: check changes against Rigo's rules before they ship.
- `/ship [summary]`: run the checks, update the docs, push once and open a draft PR.

## Skills
Kept small on purpose, since every skill is listed in every session. In `.claude/skills/`:
- `ui-ux-pro-max`: UI/UX design intelligence (nextlevelbuilder/ui-ux-pro-max-skill, MIT).
- `impeccable`: design commands for critiquing, auditing and polishing UI (pbakaus/impeccable,
  Apache-2.0). Point it at `docs/PRODUCT-VISION.md` and `docs/DESIGN-SYSTEM.md` rather than
  letting `init`/`document` create root `PRODUCT.md`/`DESIGN.md`, and don't install its editor
  hooks. Its launcher downloads a checksum-verified binary into `~/.impeccable/` on first use.
- `playwright-cli`: drive a browser from the command line (microsoft/playwright-cli,
  Apache-2.0). Install with `npm install -g @playwright/cli@latest`. In the cloud container
  set `PLAYWRIGHT_MCP_BROWSER=chromium PLAYWRIGHT_MCP_EXECUTABLE_PATH=/opt/pw-browsers/chromium`
  and run it from the scratchpad. `e2e/run.mjs` stays the automated browser check. Never sign
  in to or change data on the live site without the owner's go-ahead.

Rigo's confirmed palette and `docs/DESIGN-SYSTEM.md` always take precedence over any skill.
Other design skills (brand, logo, banner, slides, shadcn/Tailwind, DESIGN.md) were removed;
re-add one from its upstream repository only if the owner asks.
