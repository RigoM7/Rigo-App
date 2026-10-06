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
- `.claude/settings.json` allows the routine commands (npm installs and scripts, the
  checks above, Playwright, everyday git) without a prompt, and denies force pushes
  and `git reset --hard`. Add to that list when the owner approves a new command.
  It also carries `defaultMode: bypassPermissions`, which has no effect: Claude Code
  ignores that value in a repository's settings, both locally and in the cloud. For
  bypass mode, the owner starts a local session with
  `claude --permission-mode bypassPermissions` (or sets it in their own
  `~/.claude/settings.json`); cloud sessions use the mode dropdown. Only the owner
  changes the permission mode.

## Prompts
The owner's reusable prompts for building Rigo live in `.claude/commands/`; each file runs as
`/<name>` in a Claude session. Write new ones with `/new-prompt` and list them here. Changes
that only touch `.claude/` and this file don't trigger a Vercel build.
- `/new-prompt <idea>`: turn an idea into a new prompt in this library.
- `/feature <feature>`: build a feature end to end (server, client, tests, docs).
- `/screen <screen and change>`: design, build or redesign a screen to the design system.
- `/fix <bug>`: reproduce a bug with a test, fix the root cause.
- `/review [PR or branch]`: check changes against Rigo's rules before they ship.
- `/ship [summary]`: run the checks, update the docs, push once and open a draft PR.

## Skills
Third-party design skills from nextlevelbuilder/ui-ux-pro-max-skill v2.13.0
(MIT; `ui-styling` is Apache-2.0), in `.claude/skills/`:
- `ui-ux-pro-max`: UI/UX design intelligence. Use it for UI design work.
- `design-system`, `brand`, `design`, `banner-design`, `slides`, `ui-styling`:
  tokens/components, brand voice and identity, logos and design assets, banners,
  HTML presentations, and shadcn/Tailwind styling. Rigo's UI is plain CSS with its
  own tokens, so `ui-styling` advice applies only to separate projects. Scripts that
  call outside services (logo generation, stock backgrounds) need their own API
  keys and are never run automatically.
- `design-taste-frontend`: Taste Skill v2 (Leonxlnx/taste-skill, MIT), an
  "anti-slop" guide for landing pages, portfolios and redesigns. It is not meant for
  dashboards or dense product UI, so use it for marketing pages, not the app screens.
- `impeccable`: Impeccable v4.5.0 (pbakaus/impeccable, Apache-2.0), design commands
  for building, critiquing, auditing and polishing UI (`/impeccable audit`, `polish`,
  `harden`, `adapt` and others). Its `scripts/impeccable` launcher downloads a
  version-pinned, checksum-verified engine binary from the project's GitHub releases
  into `~/.impeccable/` on first use; if that fails, the skill falls back to reading
  the context files directly. Rigo's product and design context lives in
  `docs/PRODUCT-VISION.md` and `docs/DESIGN-SYSTEM.md`: point the skill there rather
  than letting `init`/`document` create competing root `PRODUCT.md`/`DESIGN.md`
  files, and don't install its editor hooks.
- `playwright-cli`: Microsoft's Playwright CLI skill (microsoft/playwright-cli,
  Apache-2.0, from commit b85c7a7), for driving a browser from the command line:
  open pages, click, fill, take snapshots and screenshots, mock requests, trace, and
  generate or debug Playwright tests. It needs the `playwright-cli` command, which is
  not part of the project; install it globally with
  `npm install -g @playwright/cli@latest` (allowed in `.claude/settings.json`). In the
  cloud container it defaults to Chrome, which isn't installed, so set
  `PLAYWRIGHT_MCP_BROWSER=chromium PLAYWRIGHT_MCP_EXECUTABLE_PATH=/opt/pw-browsers/chromium`
  and run it from the scratchpad so its `.playwright-cli/` output stays out of the repo. Use it for
  checking pages by hand; `e2e/run.mjs` stays the automated browser check. Point it at
  a local build or a preview, and never sign in to or change data on the live site
  without the owner's go-ahead.
- `design-md`: Google Labs' DESIGN.md format (google-labs-code/design.md at 9bf8eae,
  Apache-2.0). That repository ships a spec and a CLI, not a skill, so this skill wraps
  them: its spec, philosophy and an example, plus how to `lint`, `diff` and `export` with
  `npx -y @google/design.md@0.4.0`. Rigo has no root `DESIGN.md`; create one only when the
  owner asks, generated from `src/client/styles.css` and `docs/DESIGN-SYSTEM.md` and kept
  in sync with them.

Rigo's confirmed palette and `docs/DESIGN-SYSTEM.md` always take precedence over
any skill's suggestions.
