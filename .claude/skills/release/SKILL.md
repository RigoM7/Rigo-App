---
name: release
description: Publish an approved /change as one push and draft PR, or merge, undo, list or cancel Rigo PRs. Use when the owner types /release.
argument-hint: "[merge | undo | status | cancel]"
disable-model-invocation: true
---

# /release

Mode: $ARGUMENTS (empty means publish). Plain words map to modes: "merge" is `merge`, "undo the
last change" is `undo`, "what's open?" is `status`, "cancel" is `cancel`. Rules live in
`docs/PROCESS.md`; read only the headings named below.

## Publish (no argument)
Only after `/change` finished and the owner approved in this session. If nothing was approved,
stop and say so.
1. **Confirm** in one line what is being released.
2. **Re-check:** `npm run typecheck` and the area's tests; `npm run check:docs` if the maps
   changed.
3. **Docs:** update `docs/IMPLEMENTATION-STATUS.md`, and `docs/AREAS.md` or `docs/SCHEMA.md` if
   files, tests or tables changed. Keep them honest.
4. **Commit and push once**, following "Releasing". No `[checkpoint]` on a release. Push again
   only if the owner asks for changes after the preview, batched into one push.
5. **Open a draft PR** from the template, filling every row of the "Checklist" and the
   "Decisions" section.
6. **Preview:** give the Vercel preview link once its deployment is ready.
7. **Notify** the owner once, with a phone notification if available.
8. **Stop.** Never merge on your own.

## merge
1. Confirm every check on the PR's latest commit is green. If not, stop and say what is red.
2. Mark the PR ready for review (a draft can't merge), then turn on auto-merge.
3. While `main` has no required check, auto-merge merges at once, so step 1 is the guard.
4. After it merges, confirm the production deployment succeeded and the post-deploy check
   passed. If it failed, follow "First aid".

## undo
Revert the last merged change on a new branch from the latest `main` and open a revert PR with
the reason. It merges only on the owner's "merge". In an emergency the owner promotes the
previous deployment in Vercel (see "First aid").

## status
List open PRs: title, area, checks, and what each is waiting on.

## cancel
Name the draft PR and ask once. On yes, close it and delete its branch.

Report in three lines (see "Reports"). Say anything you couldn't verify.
