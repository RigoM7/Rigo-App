---
type: topic
updated: 2026-10-06
sources: ["[[repo PRODUCT-VISION (2026-10-06)]]", "[[repo IMPLEMENTATION-STATUS (2026-10-06)]]", "[[repo CLAUDE (2026-10-06)]]"]
---
# People, roles and access

## Accounts and companies
- Anyone can create a personal account. Signed in, they can explore the [[Demo]], create a company (becoming its owner), open companies they belong to, or accept invitations.
- One person can own several companies, work for several, and hold a different role in each.
- Companies can have several owners. The **last active owner** can't be removed, demoted, or delete their account.

## Role presets
| Role | Typical use |
|---|---|
| **Owner** | Everything, including member management and approval authority |
| **Dispatcher** | Records and assigns jobs, timeline, bulk actions |
| **Driver** | "My jobs" on a phone; never sees rates |
| **Office/billing** | Invoices, payments, messages |

Owners can edit role permissions across records, fields, actions, financial visibility, workflow configuration, approval authority and member management. Approval authority can be delegated for a period.

## Invitations
Emailed (locally: simulated mailbox) single-use invitations bound to the invitee's address, with expiry, revoke, replace, wrong-account guidance and race-safe acceptance.

## How access is enforced
- Every company-owned query is scoped by `company_id` and checked with the permission helpers in `src/server/http/context.ts`.
- Non-members get **404**, not 403, so a company's existence isn't revealed.
- Financial and contact fields are **removed server-side**, not hidden in the UI (e.g. drivers get no rates; amounts are removed without `finance.view`).
- The command menu never lists something a person can't open; the server checks again.

## Related
- [[Accounts, sign-in and recovery]] · [[Product principles]] · [[Dispatch to invoice journey]]
