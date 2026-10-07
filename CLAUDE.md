# Working on Rigo

Rigo is a field-service app (React + Hono + PostgreSQL, TypeScript). Live site:
https://rigo-app-dun.vercel.app (Vercel project `rigo-app`, team `rigo9`). Start with
`README.md`.

## How changes are made
- `/change <what>`: build a change from the owner's text or picture and show before and after
  screenshots, up to approval. It never pushes.
- `/release [merge | undo | status | cancel]`: publish an approved change as one push and a draft
  PR, then merge, undo, list or cancel on the owner's word.
- The rules, checklist, first aid and owner-only actions are in `docs/PROCESS.md`. Read it by
  heading. The code map is `docs/AREAS.md`; tables are in `docs/SCHEMA.md`.

## Always
- Do the task directly; stop only for a decision that is the owner's ("Stop and ask" in
  `docs/PROCESS.md`) or when access or a safety check blocks the work.
- Never merge into `main` until the owner says "merge".
- Vercel deployments are limited: one branch, one PR and one push per batch of work.
- Company-owned queries are scoped by `company_id` and permission-checked on the server.
- Visual work follows "Visual research and licences" in `docs/PROCESS.md`; Rigo's confirmed
  palette and `docs/DESIGN-SYSTEM.md` take precedence over any skill.
- Keep `docs/IMPLEMENTATION-STATUS.md` honest.

## Checks
- `npm run typecheck` (about 5 s) and the area's tests: `npx vitest run <files>`.
- `npm run check:docs` keeps `docs/AREAS.md` and `docs/SCHEMA.md` in line with the code.
- The full suite (about 10 min) and the browser check run on GitHub for every PR.

## Skills
- `change` and `release`: above.
- `ui-ux-pro-max` (nextlevelbuilder/ui-ux-pro-max-skill v2.13.0, MIT) and `impeccable`
  (pbakaus/impeccable v4.5.0, Apache-2.0): design judgment for new or redesigned screens only.
  Point `impeccable` at `docs/PRODUCT-VISION.md` and `docs/DESIGN-SYSTEM.md`; don't let it create
  root `PRODUCT.md` or `DESIGN.md` files or install its editor hooks. Its launcher downloads a
  pinned, checksum-verified engine into `~/.impeccable/` on first use.
- `playwright-cli` (microsoft/playwright-cli, Apache-2.0): checking pages by hand. Install with
  `npm install -g @playwright/cli@latest`; in the cloud set
  `PLAYWRIGHT_MCP_BROWSER=chromium PLAYWRIGHT_MCP_EXECUTABLE_PATH=/opt/pw-browsers/chromium` and
  run it from the scratchpad. Use a local build or a preview, never the live site without the
  owner's go-ahead.

## Settings
`.claude/settings.json` allows the routine commands and denies force pushes and
`git reset --hard`. Only the owner changes it. Its `defaultMode` has no effect in a repository;
the owner sets the permission mode in their own session. Never push to `main` or edit an
applied migration. Commits that only touch docs, `.claude/`, `.github/` or this file skip Vercel builds; a
first line containing `[checkpoint]` skips them on branches other than `main`.
