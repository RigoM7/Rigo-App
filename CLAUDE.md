# Working on Rigo

Rigo is one place where any business runs its work. `PRODUCT.md` is what it is, does and doesn't
yet, and the owner's decisions; `DESIGN.md` is the look; `README.md` is how to run, check and ship,
and the code map. Live site: https://rigo-app-dun.vercel.app. While the rebuild runs,
`docs/REBUILD.md` says where it stands: "continue the rebuild" starts there.

## The owner
- Decides what Rigo does and how it looks. Not a developer; runs a field-service business. Claude
  makes the technical calls.
- Works from the phone or web app. Chat is short, with a plain-English line when a decision is theirs.
- Every task ends with one summary: what changed, what was picked where it was ambiguous, docs read
  and updated, check results (failures stated plainly) and the pull request link.

## How to work
- Do the task directly, including setup in connected services (Supabase, Vercel, GitHub; Figma and
  Canva for design). Never Gmail, Calendar or Drive unless asked. Never hand the owner steps.
- Ambiguous but not dangerous: pick the sensible option, build it, say what was picked. If an idea
  seems wrong, say so in a line, then follow the owner.
- Small problems nearby: fix them. Big ones: mention them.
- When checks fail, keep trying until they pass; stop only when the cause is outside the code.
- The only approval needed is launching. Screenshots only when the owner asks.

## The owner's words
- **"Show me":** push without `[checkpoint]` (migrations held back) and send the preview link.
- **"Launch":** run all checks, apply held migrations to Supabase, mark the pull request ready, merge
  into `main`, confirm the live site.
- **"Status":** what's on the branch and not launched. **"Cancel X":** take it off the branch.
- **"Undo":** revert the last launch with a revert pull request and merge it.

One branch, one draft pull request; pushes in between start with `[checkpoint]` (`README.md`,
"Shipping to the live site").

## Rules that never bend
- Every workspace-owned query is scoped by `company_id` with the helpers in
  `src/server/http/context.ts`; non-members get 404. Contact and money fields are removed on the
  server (`src/server/lib/redact.ts`), never just hidden.
- Business rules live in `src/shared/`. Money is exact, in minor units; a missing price holds an
  invoice; AI never computes prices, taxes or totals.
- Honest states: nothing claims a send, sync, payment or approval that didn't happen. Nothing approves
  itself; timeouts never approve.
- External services go through `src/server/adapters/` and stay off or simulated until configured.
  Demo workspaces never reach a provider.
- Migrations are new numbered files that only add; never edit one on `main`. They stay out of preview
  pushes and are applied at launch.
- Live data: read-only counts only. The QA account (`RIGO_QA_*`) only with the owner's go-ahead.

## Tests
- Every change adds or extends a test, including a permission or isolation case. A bug gets a failing
  test first. Never skip, weaken or delete a test.
- Sign-in, permission and customer-data changes get `/security-review` before shipping.
- Locally: `npm run typecheck` and the area's tests (README.md, code map). The full suite and the
  browser check run on GitHub for every pull request.

## Keep the docs true
What the app does → `PRODUCT.md` (and its "Not yet" table). Files, tests or tables → the code map in
`README.md` (`npm run check:docs` must pass). The look → `DESIGN.md` (lint it as it says). A product
decision → `PRODUCT.md`, Decisions. How Claude works → this file.

## First aid
- **The live site broke after a launch:** in Vercel, promote the previous production deployment,
  then "undo".
- **The post-deploy check opened an issue:** it links the revert pull request it prepared.
- **A pull request check failed:** fix the cause and push; never skip it.

## Owner-only
Approving a launch; GitHub Actions permissions and secret keys (Vercel, GitHub, the cloud
environment); the permission mode. `.claude/settings.json` blocks force pushes, `git reset --hard`
and pushes to `main`; `.claude/hooks/protect-migrations.sh` blocks editing a migration on `main`;
`.claude/hooks/session-start.sh` installs packages.
