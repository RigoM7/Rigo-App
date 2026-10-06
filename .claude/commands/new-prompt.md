---
description: Turn an idea into a new reusable Rigo prompt, saved as a slash command
argument-hint: <what the prompt should get Claude to do>
---

Write a new reusable prompt for working on Rigo and save it as a slash command.

The owner's idea for the prompt:

$ARGUMENTS

1. If the idea is empty, ask the owner what the prompt should do, then continue.
2. Read `CLAUDE.md`, `README.md` and the docs the idea touches (`docs/PRODUCT-VISION.md`,
   `docs/DESIGN-SYSTEM.md`, `docs/UI-GUI-PROMPT.md`, `docs/IMPLEMENTATION-STATUS.md`), and
   list the existing prompts in `.claude/commands/`. If an existing prompt already covers the
   idea, improve that one instead of adding a near-duplicate, and say so.
3. Pick a short, lowercase, hyphenated name (for example `driver-screen`, `add-service`). The
   file is `.claude/commands/<name>.md` and runs as `/<name>`.
4. Write the file:
   - Frontmatter with a one-line `description` and, when the prompt takes input, an
     `argument-hint`. Use `$ARGUMENTS` where the owner's input goes.
   - Address Claude directly and say what done looks like.
   - Point to the docs and code paths it needs instead of copying them, so the prompt stays
     correct as the docs change. Repeat only the rules that matter most for this task.
   - Keep Rigo's standing rules: company scoping and permission checks on the server, business
     rules in `src/shared/`, honest states, the confirmed palette, docs kept in sync, and one
     branch and one pull request per batch of work.
   - Keep it as short as the task allows.
5. Add a line for the new prompt to the "Prompts" list in `CLAUDE.md`.
6. Show the owner the finished prompt and how to run it. Commit it with the other prompt
   changes; changes that only touch `.claude/` and `CLAUDE.md` don't trigger a Vercel build.
