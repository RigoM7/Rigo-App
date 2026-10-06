# PR #9: Add skills and a command allow list for Claude sessions

https://github.com/RigoM7/Rigo-App/pull/9 · state: closed · merged: 2026-10-06T11:29:51Z

## Summary
Adds third-party skills under `.claude/skills/` and a command allow list in `.claude/settings.json` for Claude Code sessions on this repo. No app code changes; Vercel skips the build (only `.claude/` and `CLAUDE.md` change).

### Skills
- **ui-ux-pro-max companions** (nextlevelbuilder/ui-ux-pro-max-skill v2.13.0, MIT; `ui-styling` Apache-2.0): `design-system`, `brand`, `design`, `banner-design`, `slides`, `ui-styling`.
- **Taste Skill** (`design-taste-frontend`, Leonxlnx/taste-skill, MIT): anti-slop guidance for marketing pages and redesigns, not dense app screens.
- **Impeccable** v4.5.0 (pbakaus/impeccable, Apache-2.0): design commands (`/impeccable audit`, `polish`, `harden`, `adapt`, …). Its launcher downloads a version-pinned, checksum-verified engine binary from the project's GitHub releases on first use, and falls back to reading the context files directly if that fails.
- **Playwright CLI** (`playwright-cli`, microsoft/playwright-cli at b85c7a7, Apache-2.0): drives a browser from the command line. Needs the `playwright-cli` command (`npm install -g @playwright/cli@latest`, not a project dependency). Verified in a cloud session: it opens the live sign-in page when pointed at the preinstalled Chromium.

Each skill ships with its license.

### Command allow list (`.claude/settings.json`)
- **Allowed without a prompt:**
  - npm installs and scripts, and the project checks (`npm test`, `npm run …`, `npx tsc/vitest/vite/playwright`)
  - the Playwright CLI and its global install
  - everyday git: status, diff, log, add, commit, fetch, pull, checkout, merge, and `push -u origin`
- **Denied:** `git push --force` / `-f` and `git reset --hard`.

### CLAUDE.md
Documents what each skill is for, its limits, and the allow list:
- Rigo's palette and `docs/DESIGN-SYSTEM.md` take precedence over any skill's suggestions.
- Impeccable is pointed at `docs/PRODUCT-VISION.md` and `docs/DESIGN-SYSTEM.md` so it doesn't create competing root `PRODUCT.md` or `DESIGN.md` files, and its editor hooks are not installed.
- Playwright CLI is for checking pages by hand on a local build or preview, and needs the Chromium environment variables in the cloud container. `e2e/run.mjs` stays the automated browser check. It never signs in to or changes the live site without the owner's go-ahead.
- Scripts that call outside services aren't run automatically.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Xp2EqZUToyNw5BBzm2xeTX
