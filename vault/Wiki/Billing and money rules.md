---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo IMPLEMENTATION-STATUS (2026-10-06)]]", "[[PR 06 Platform milestones A–F and G groundwork - companies, demo, operations]]"]
---
# Billing and money rules

- Prices, quantities, discounts, taxes and totals use **exact decimal arithmetic in minor units**. The math lives in `src/shared/` and is covered by `domain.test.ts`.
- **A missing rate holds the invoice.** It's never priced at zero. A price change rebuilds held invoices.
- **One invoice per billable event**; preparing twice returns the same invoice.
- Invoices come only from **confirmed data** (the server-accepted job record).
- States are separate and shown in separate cells: **invoice** (draft / approved / issued / void), **approval**, **delivery**, **payment**, **total**.
- Invoice list is grouped by work state: on hold, draft or awaiting approval, approved, issued awaiting payment, paid, void.
- Payments are recorded (idempotent by key), **not processed**: no payment provider.
- The printable invoice always renders on white with the company's branding; print/save as PDF uses the browser.
- AI is never the authority for prices, taxes or accounting rules.
- **Quantities:** invoice lines are built from the driver's recorded quantities. To bill a different amount, someone allowed to edit invoices changes the draft invoice's lines before approval (`src/server/modules/billing.ts`). The previous app (PR #6) kept requested, actual and billable quantities as separate fields and required an owner and a reason to bill a different quantity; the rebuild doesn't have that rule.
- A partial visit holds its invoice with "The visit was only partly completed. Review quantities before approving." (`src/server/modules/invoicing.ts`).

## Related
- [[Dispatch to invoice journey]] · [[Product principles]] · [[Automation, workflows and approvals]]
