---
description: Change one part of Rigo
argument-hint: <area> <what to change>
---

Change Rigo: $ARGUMENTS

The first word is the area (`docs/AREAS.md`; `new` for a new area or a change spanning several).

1. Read only the area's section: `grep -n -A8 "^## <area>$" docs/AREAS.md`. Then read `docs/WORKFLOW.md`
   sections "Rules", and "UI changes" if anything visible changes. Read other docs by heading only.
2. If it's a bug, write the failing test first and find the root cause. If a product decision is
   genuinely the owner's, ask; otherwise decide and say what you decided.
3. Make the smallest change that meets the rules. Reuse existing code and components. Don't re-read
   files you just edited.
4. Check as you go with `npm run typecheck` and `npx vitest run` on the area's test files only.
5. Stop with a three-line summary (what changed, what you decided, what's left) and "run `/release`".
   Don't push; commit locally.
