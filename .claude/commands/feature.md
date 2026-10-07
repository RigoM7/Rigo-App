---
description: Build a Rigo feature end to end (server, client, tests, docs) on one branch and PR
argument-hint: <the feature to build>
---

Build this feature in Rigo, end to end:

$ARGUMENTS

Before writing code:
- Read `CLAUDE.md`, `README.md`, `docs/PRODUCT-VISION.md` and `docs/IMPLEMENTATION-STATUS.md`.
  For anything visible, also read `docs/DESIGN-SYSTEM.md` and `docs/UI-GUI-PROMPT.md`.
- Find the code that already does something similar (`src/server/modules/`, `src/shared/`,
  `src/client/pages/`, `test/`) and follow its patterns.
- If the feature conflicts with the product vision, or a product decision is genuinely the
  owner's, ask before building. Otherwise decide sensibly and say what you decided.

While building:
- Business rules (pricing math, job states, workflow validation) go in `src/shared/`. Money uses
  exact decimal arithmetic in minor units; a missing rate holds an invoice, never prices it at 0.
- Every company-owned query is scoped by `company_id` and checked with the permission helpers
  in `src/server/http/context.ts`. Remove financial and contact fields on the server, not in the
  UI.
- Schema changes are a new numbered file in `migrations/`; never edit an applied migration.
- External services go through `src/server/adapters/` and stay disabled or simulated unless
  configured. Demo companies never reach a provider.
- UI uses the existing tokens and components, and has loading, empty, error and
  permission-denied states. Unavailable features are labeled, never silently inert.
- Add tests in `test/` for the new behavior, including a permission or isolation case. Extend
  `e2e/run.mjs` when the feature adds a key flow or page.

Then run `/ship` to check, document and open the pull request.
