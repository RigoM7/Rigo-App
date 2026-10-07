---
name: change
description: Build and show a change to Rigo from the owner's text or picture, up to approval; never pushes. Use when the owner types /change.
argument-hint: "[what to change]"
disable-model-invocation: true
---

# /change

The owner wants: $ARGUMENTS

They may add a picture, an area and a "Done when" line. Rules are in `docs/PROCESS.md`;
read only the headings named below.

1. **Understand.** If there's a picture, say in one sentence what you see. If you aren't sure
   which element they mean, show what you think they mean (a screenshot or the file and line)
   and wait for their answer.
2. **Find the area.** Use the area they named, or pick one from `docs/AREAS.md` and say which.
   Read that section (and its "Read also" docs only if needed): about 1,000 words in total.
3. **Check overlap.** If an open PR touches the same area's files, warn the owner and wait.
4. **Stop and ask** if the change hits anything under "Stop and ask". Don't build until they
   answer.
5. **Build** to "Building rules" and "Tests": a failing test first for a bug, and a test with a
   permission or isolation case for every change. Migrations follow "Database and live data".
   Visual work also follows "Screens" and "Visual research and licences".
6. **Check locally.** `npm run typecheck`, then `npx vitest run` with the area's test files
   only. Never the full suite here. If `docs/AREAS.md` or `docs/SCHEMA.md` changed, run
   `npm run check:docs`.
7. **Shared files.** If you touched a file under "Shared files", also run the tests listed for it
   at the top of `docs/AREAS.md`, and say so in your report.
8. **Show the owner.** Start the local app (`npm run build && npm start &`, embedded database, on
   `http://localhost:8787`), open "Explore the demo", and screenshot before and after at 390px and
   1440px wide. Send the screenshots. If they asked for "two options", build and show both.
   Never use the live site or a Vercel deployment for this step.
9. **Adjust.** Apply what they say in plain words and send new screenshots. Repeat until they
   approve.
10. **Batch.** Several small changes go together, about five per PR.

Limits:
- After three failed attempts at the same fix, stop and report what you tried. Never skip,
  weaken or delete a test.
- Problems outside the request become suggested tasks, not part of this change.
- If the change touches sign-in, permissions or customer data, run `/security-review` before
  reporting.
- Never commit, push or open a PR. Keep track of what was approved, the area and the test files,
  for `/release`.

When the owner approves, report in three lines (see "Reports") and end with:
"Ready for `/release`."
