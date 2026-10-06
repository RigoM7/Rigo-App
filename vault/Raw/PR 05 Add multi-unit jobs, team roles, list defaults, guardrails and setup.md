# PR #5: Add multi-unit jobs, team roles, list defaults, guardrails and setup

https://github.com/RigoM7/Rigo-App/pull/5 · state: closed · merged: 2026-10-05T15:57:54Z

## Summary
Groups 2–4 from the 370 Enviro test run, in a single PR to keep Vercel deployments down.

**Group 2: data model**
- **4. Multiple equipment units per job:** jobs store `equipmentIds`, with `equipmentId` kept as the first unit for compatibility.
  - Units can be added in Create job and in the job detail, and the job list shows them.
  - Dispatch conflict checks, equipment tracking, completion effects, reopening, merges and link checks all cover every unit.
  - Quantity follows the unit count for "each" services and stays editable for others (fuel).
- **5. Team roles:** Team gets Role (Driver/Field, Dispatcher, Office) and Phone.
  - Only field roles, or people with no role yet, are offered for assignment, and the server rejects the rest.
  - Coordinator is a pick list of Dispatcher/Office staff, defaulting to the signed-in user's linked Team record.
- **6. List defaults:**
  - Vehicles: type, capacity, capacity unit, plate.
  - Equipment: type, status, current location.
  - Service locations: the Group 1 fields.
  - Services: unit of measure is now a required choice (each/gallon/hour/visit, plus any values already in use).
  - Existing workspaces are upgraded once, and a field with the same name is reused rather than duplicated.
  - Archived rows no longer block list builder edits.
  - Coordinates can be typed in Create job, or looked up from the address when `MAPBOX_TOKEN` is set (new `geocode` route, documented in `DEPLOYMENT.md`).
- **7. Units shown:** the service's unit appears next to quantities in Create job, the detail, the list and completion.

**Group 3: guardrails**
- **8. Zero price:** warnings in Create job and completion, a "⚠ No price" flag in Services, and a count in the Services header.
- **9. Import guard:** the review step shows "Importing into: Services", and the button reads "Import N rows into Services". It warns when headings or record IDs don't match the list, e.g. "They look like Team records".
- **10. Acknowledgment:** a new process rule, off by default and enforced on the server for both status moves and completion. Jobs say plainly that no notification was sent and link the driver's phone.
- **11. Status history:** each status change is recorded with time and actor, plus a reason when moving back. The first step is recorded even when a job starts at step 2.

**Group 4: ease of use**
- **12. Status control:** a next-step button ("Mark En Route" → "Mark On Site" → "Complete…") replaces the status dropdown. Moving back sits in a secondary menu with a confirmation and a reason that the server requires.
- **13. Setup:** a checklist on the Jobs page plus starter templates (portable sanitation, fuel, septic, combined). New workspaces now land on the Jobs page instead of being sent to Settings.
- **14. Disabled controls explain why:** New job, Create job, Record completion, step buttons, Undo, Preview/Import, Archive, Send invitation, and reassignment of completed jobs.
- **15. Naming and job numbers:** the page title follows the vocabulary ("Jobs"). Jobs get numbers like J-1001, and existing jobs are numbered in creation order; only the number is added.
- **16. Layout:**
  - The job list fits a 1366px laptop with no sideways scroll: secondary columns fold away and the actions column is pinned.
  - Create job has Assignment and Quantity & Price sections and a sticky footer.
  - Process step buttons are now "← Earlier / Later →".
- **17. Demo data:** owner-only, labelled "Demo ·" with DEMO badges, and removed in one action. Removal is refused if real records use demo ones.

No SQL schema changes: list fields and jobs live in the workspace JSON. RLS and server-side access checks are unchanged. Completed jobs keep their steps, checklist and pricing; the only addition is a display number.

## Testing
- `npm test`: 39/39 pass. New `tests/groups234.test.cjs` covers:
  - list defaults and unit migration;
  - role enforcement;
  - multi-unit quantity sync and deletion protection;
  - equipment tracking across units through assign, complete and reopen;
  - status history, backward-move reasons, and the acknowledgment rule;
  - job numbering;
  - templates;
  - demo load/remove (including the refusal case);
  - import warnings.
- New `tests/groups234.browser.cjs` runs the real app in Chromium against a mock server that applies actions with the real rules:
  - first run: checklist, template, then demo load and remove;
  - Create job: zero-price warning, team filter, coordinator default, 4 units → quantity 4;
  - the job list at 1366px;
  - job detail: no-notification note, next-step button, history, moving back with a reason;
  - the Services price flag, the process builder, and the import guard.
- The existing `tests/browser.cjs` and `tests/group1.browser.cjs` still pass.
- A copy of the live workspace was normalized and exercised offline:
  - fields are added, jobs are numbered J-1001…J-1005, and no other job field changes;
  - assigning units, applying a template and loading/removing demo data all work on the real data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01NJzVeQfq2X9E2u8VAHicLS

---
_Generated by [Claude Code](https://claude.ai/code/session_01NJzVeQfq2X9E2u8VAHicLS)_
