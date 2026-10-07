---
description: Save a new reusable prompt as a command
argument-hint: <what the prompt should do>
---

Write a reusable prompt for Rigo and save it as `.claude/commands/<short-hyphenated-name>.md`.

Idea: $ARGUMENTS

If it's empty, ask what it should do. List `.claude/commands/`; if one already covers it, improve
that one. Frontmatter: a description of a few words (every command's description loads in every
session) and an `argument-hint`. Say what done looks like, point to `docs/WORKFLOW.md` and
`docs/AREAS.md` instead of copying rules, and keep it as short as the task allows. Add one line to
the Prompts list in `CLAUDE.md` and show the owner how to run it.
