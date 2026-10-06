---
type: reference
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo DESIGN-SYSTEM (2026-10-06)]]"]
---
# Glossary

- **Company / workspace:** one business in Rigo. All its records are isolated by `company_id`.
- **Owner, Dispatcher, Driver, Office/billing:** role presets. See [[People, roles and access]].
- **Job:** one service visit. Statuses (`src/shared/jobs.ts`): Draft, Open, In progress, Completed, Partially completed, Unsuccessful visit, Cancelled. Billing status is tracked separately: Not ready, Not billable, Ready to bill, Invoice held, Invoice drafted, Invoice approved, Invoiced.
- **Held invoice:** an invoice that can't proceed (missing rate or quantity, partial visit) until someone reviews it.
- **Prepared / Simulated / Blocked / Sent:** honest message and action states. Prepared = ready, not sent. Simulated = demo only. Blocked = can't run, with a reason.
- **Manual / Assisted / Automatic:** automation modes. See [[Automation, workflows and approvals]].
- **Draft → Tested → Active:** workflow version lifecycle.
- **Takeover:** an owner stops a run and finishes it by hand.
- **Needs you:** the strip on Home with items waiting on a person, each with a visible action.
- **Now line:** the red line on the dispatch timeline marking the current time.
- **Chrome:** the black top bar, sidebar and bottom nav.
- **Reset link:** a single-use password reset link an owner creates from Team when no email service exists.
- **Demo:** a per-visitor fictional company. See [[Demo]].
- **Checkpoint commit:** a commit whose first line contains `[checkpoint]`; skips the Vercel build off `main`.
- **Round N:** a pass of the owner's user critique, fixed in one PR.
