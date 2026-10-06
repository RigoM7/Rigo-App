---
description: Check, document, commit, push once and open a draft PR for the current work
argument-hint: [short summary of the change]
---

Ship the current work on this branch: $ARGUMENTS

1. Run every check and fix what fails:
   - `npm run typecheck`
   - `npm test`
   - For UI or flow changes: `npm run build && npm start &`, then
     `NODE_PATH=$(npm root -g) npm run test:browser`.
2. Re-read the whole diff against `main` as a reviewer would (the `/review` checklist) and fix
   anything you find.
3. Update `docs/IMPLEMENTATION-STATUS.md` so it honestly says what is built, verified,
   simulated or deferred, including the latest test results. Update `README.md` or the other
   docs if the change affects them.
4. Commit with a clear message. Work-in-progress pushes that shouldn't deploy start the first
   line with `[checkpoint]`.
5. Push once (Vercel deployments are limited) and open one draft pull request, or update the
   existing one, describing what changed and how it was checked.
6. Don't merge into `main`; ask the owner first.
