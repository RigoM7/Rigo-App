---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo UI-GUI-PROMPT (2026-10-06)]]"]
---
# Dispatch to invoice journey

The core operational flow, end to end:

1. Customer contacts the company.
2. **Dispatcher records the job.** Drafts are allowed; "Save as draft" lists what's missing. Duplicate submissions are guarded by `clientRequestId`.
3. **Dispatcher assigns** a driver, truck and equipment. Conflicts are prevented; stale edits are refused. Assignment is by select (on the timeline side panel, the jobs table, or in bulk). Dragging is never required.
4. **Driver sees it in My jobs** (phone): Today, Upcoming, Finished.
5. **Driver records the outcome:** actual quantities, notes, photos, signature, and completed / partial / could not complete (with a reason). Offline drafts with explicit sync states: Saved on this device → Waiting to sync → Accepted by the server (or Sync failed / Conflict — needs review).
6. **The server accepts the record.** Only that completes the job.
7. **Rigo prepares the invoice** per the configured workflow. See [[Billing and money rules]].
8. **Approval** if required → **issue** (numbered).
9. **Company-branded email** prepared, and sent if a provider is configured (otherwise left Prepared, or Simulated in the demo).
10. **Payment recorded.**

## Exceptions
- **Unsuccessful** visits are never billed automatically.
- **Partial** visits produce a **held** invoice for review.
- **Corrections** to finished records keep history, rebuild draft invoices and invalidate stale approvals.
- **Problems** reported by drivers show on the timeline with a danger outline and in the Home "Needs you" strip.

## Related
- [[Automation, workflows and approvals]] · [[Design system]] (timeline, driver screens) · [[People, roles and access]]
