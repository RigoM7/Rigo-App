---
description: Check and publish the current work
argument-hint: [short summary]
---

Release the current branch: $ARGUMENTS

Follow the "Release gate" table in `docs/WORKFLOW.md`. Decide which lines apply from
`git diff --stat main...HEAD`, run them in order, and stop at the first failure: fix it and resume.
Run the full suite and the browser check here, not earlier.

Finish with the table (line, pass / fail / skipped, a few words each). Commit (first line starts
with `[checkpoint]` for work that shouldn't deploy), push once, and open or update one draft PR
using the table as the description. Then wait: merge only when the owner says to. After the merge,
do gate line 11.
