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
- Data: Supabase project `rigo-app` (`dlksigvhqxpoqarpltev`). The whole workspace
  is one JSON document in `rigo_workspaces.state`; access goes only through
  `/api/rigo` (`lib/server.cjs`) with server-side role checks.
- `index.html` is a compiled, minified React bundle with no source in the repo.
  Business rules live inside it and are extracted to `lib/domain.cjs` by
  `npm run build`; never edit `lib/domain.cjs` by hand.
- Data model changes are versioned upgrades in the normalizer (`rigoUpgrade`),
  not SQL. Completed jobs are historical snapshots and must not be rewritten.
- Checks: `npm test`, plus the Playwright checks in `tests/*.browser.cjs`
  (run with `NODE_PATH=$(npm root -g)` and
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-*/chrome-linux/chrome`).
- Commits that only touch `.claude/` or this file skip Vercel builds (`ignoreCommand`).

## Skills
- `.claude/skills/ui-ux-pro-max`: third-party UI/UX design skill (MIT, from
  nextlevelbuilder/ui-ux-pro-max-skill v2.13.0). Use it for UI design work.
