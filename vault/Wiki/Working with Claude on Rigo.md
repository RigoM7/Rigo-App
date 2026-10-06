---
type: topic
updated: 2026-10-06
sources: ["[[repo CLAUDE (2026-10-06)]]", "[[prompt feature (2026-10-06)]]", "[[prompt fix (2026-10-06)]]", "[[prompt review (2026-10-06)]]", "[[prompt screen (2026-10-06)]]", "[[prompt ship (2026-10-06)]]", "[[prompt new-prompt (2026-10-06)]]", "[[PR 09 Add skills and a command allow list for Claude sessions]]"]
---
# Working with Claude on Rigo

## How the owner wants Claude to work
- Do the task directly, including setup in connected services. No plans or steps for the owner to follow.
- **Only confirm before merging a PR into `main`.**
- Vercel deployments are limited: one branch, one PR, push once. `[checkpoint]` in a commit's first line skips the build on non-main branches.
- Ask only when a decision is genuinely the owner's, or access or a safety check blocks the work.
- Keep `docs/IMPLEMENTATION-STATUS.md` honest with every change.

## Prompt library (`.claude/commands/`)
| Command | Use |
|---|---|
| `/feature <feature>` | Build a feature end to end (server, client, tests, docs) |
| `/screen <screen and change>` | Design or redesign a screen to the [[Design system]] |
| `/fix <bug>` | Reproduce with a failing test, fix the root cause |
| `/review [PR or branch]` | Check against Rigo's rules: isolation, permissions, money, honest states, demo safety, migrations, UI, tests, docs |
| `/ship [summary]` | Run checks, update docs, push once, open a draft PR |
| `/new-prompt <idea>` | Add a new prompt to the library |

## Skills (`.claude/skills/`)
`ui-ux-pro-max`, `design-system`, `brand`, `design`, `banner-design`, `slides`, `ui-styling`, `design-taste-frontend` (marketing pages only), `impeccable`, `playwright-cli`, `design-md`. Rigo's palette and `docs/DESIGN-SYSTEM.md` always beat a skill's suggestions.

## This vault
See `vault/CLAUDE.md`: read [[Index]] first, organize `Raw` into `Wiki`, save results to `Output`.

## Related
- [[Tech stack and code layout]] · [[Deployment and data]]
