---
type: topic
updated: 2026-10-06
sources: ["[[repo IMPLEMENTATION-STATUS (2026-10-06)]]"]
---
# Status: built, simulated, blocked

Snapshot of `docs/IMPLEMENTATION-STATUS.md` on 2026-10-06. That file is the honest ledger and wins over this note.

**Latest results (Round 1):** 63/63 API/domain tests on PGlite and PostgreSQL 16; 51/51 browser checks; axe clean on 18 app pages plus auth pages in light and dark; typecheck clean.

## Built and verified (highlights)
Accounts, sessions, CSRF, sign-in limits, password rule, owner reset links, company isolation, server-side permissions and field filtering, invitations, demo isolation, jobs with drafts and conflicts, driver completion, partial/unsuccessful handling, deterministic invoices, approvals bound to versions, pause/resume/takeover, versioned workflows, CSV imports, templates, recurring generation, the live dispatch timeline, command menu, responsive shell.

## Simulated or off by design
| Capability | Behavior |
|---|---|
| Customer email/SMS | No provider. Real companies: Prepared + Blocked with an explanation; "sent outside Rigo" option. Demo: Simulated. |
| Account email | Simulated mailbox locally; on the live site, recovery uses owner reset links. |
| AI | Off; labeled prepared responses. Anthropic adapter ready behind env vars. |
| Payments | Recorded, not processed. |
| Maps / routing | Not connected; "Copy address" on the driver screen. |
| Subscription billing | Not built. Companies are free. |

## Deferred
Configurable dashboard widgets; configurable job stages / multi-section forms; XLSX import; drag-to-reassign on the timeline; feed view interleaving messages and automation steps; per-field permissions beyond contact/finance; a dedicated background worker.

## Blocked on the owner
See [[Open questions]].

## Known limits
Single-instance rate limiting and worker; screen-reader and real-device offline testing still manual; owner reset links rely on trust in the company's managers.

## Related
- [[Project history]] · [[Open questions]]
