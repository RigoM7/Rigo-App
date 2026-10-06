---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]"]
---
# Product principles

The seven rules from the product vision. Every feature, screen and fix is checked against them.

1. **The owner stays in control.** Automation runs within permissions, approval rules, enabled services and safety limits. Timeouts never approve anything. Pause holds work; it never pretends to undo it.
2. **Honest states.** Draft, approved/issued, delivery and payment are separate. Prepared, simulated, blocked, sent and failed mean exactly that. Nothing claims a send, sync or price that didn't happen.
3. **Real workspaces start empty.** Templates carry structure; only the [[Demo]] carries fictional records. Nothing fictional is copied into a real company.
4. **Isolation by default.** Companies are separate. A personal account grants no company access; every company-owned record, file, export, search and assistant answer is scoped by `company_id` and permission-checked on the server.
5. **Configuration, not code.** Services, fields, pricing lines, workflows, approvals and branding are validated declarative data. No arbitrary scripts, HTML or CSS.
6. **Deterministic money.** Exact decimal arithmetic in minor units. Missing rates hold an invoice; never $0. AI is never the authority for arithmetic, prices, taxes or accounting. See [[Billing and money rules]].
7. **Works in the field.** Drivers get a focused phone screen, large controls, offline drafts and clear sync status. Only the server's acceptance completes a job.

## Related
- [[Rigo overview]] · [[Automation, workflows and approvals]] · [[Design system]]
