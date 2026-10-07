---
description: Review changes against Rigo's rules
argument-hint: [PR number or branch]
---

Review $ARGUMENTS (default: the current branch against `main`).

Read `docs/WORKFLOW.md` "Rules" (and "UI changes" if the diff is visible), then check the diff
against each rule. Report only real problems, most serious first, with file and line, plus the
`npm run typecheck` and `npm test` results. Don't change code; list the fixes and offer to make them.
