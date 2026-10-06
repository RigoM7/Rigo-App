---
description: Find the root cause of a Rigo bug, prove it with a test, and fix it
argument-hint: <what's wrong, and where you saw it>
---

Fix this bug in Rigo:

$ARGUMENTS

1. Reproduce it first: write a failing test in `test/` (or a browser check in `e2e/run.mjs`
   for UI-only bugs). If you can't reproduce it, say what you tried and what you need from the
   owner, and stop.
2. Find the root cause, not just the symptom. Check whether the same mistake exists elsewhere
   and fix those too.
3. Make the smallest fix that keeps Rigo's rules: company scoping and permission checks on the
   server, business rules in `src/shared/`, honest states.
4. Show the test failing before the fix and passing after.
5. Never skip, weaken or delete a test to get green.

Then run `/ship`. If the bug affected data on the live site, say what was affected; don't
change live data without the owner's go-ahead.
