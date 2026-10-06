---
type: timeline
updated: 2026-10-06
sources: ["[[git log (2026-10-06)]]", "[[PR 01 Add employee self sign-up with owner approval and installable app]]", "[[PR 04 Fix undo import, saved location details and completion notes]]", "[[PR 05 Add multi-unit jobs, team roles, list defaults, guardrails and setup]]", "[[PR 06 Platform milestones A–F and G groundwork - companies, demo, operations]]", "[[PR 08 Rebuild Rigo as a new application]]", "[[PR 10 Round 1 - fix sign-in, password recovery, accounts and the front page]]", "[[PR 12 Redesign every screen as the Light command center UI]]"]
---
# Project history

## Era 1: the first app (Oct 4–6, 2026)
A single-page app (it started as an uploaded `Fieldbase.html`) storing each workspace as a Supabase `jsonb` document, with Supabase Auth.

| Date | PR | What happened |
|---|---|---|
| Oct 4 | none | Uploaded; owner-issued employee invitations and shared Supabase access |
| Oct 5 | #1 | Employee self sign-up with owner approval; installable on phones |
| Oct 5 | #2, #3 | Sign out in the account menu; hid the browser-backup toolbar when signed in |
| Oct 5 | #4, #5 | Fixes and features from the **370 Enviro test run**: undo import, saved locations, completion notes, multi-unit jobs, team roles, guardrails |
| Oct 6 | #6, #7 | Platform milestones A–F (companies, isolated demo, operations, Today + automation, setup + messages, sharing between companies) and G groundwork (offline shell, store-ready manifest, plan/usage) |

Ideas from Era 1 that the rebuild **didn't** carry over: sharing agreements between companies, an "All my companies" view, paid address lookup with per-company caps, separate requested/actual/billable quantities. They're candidates if the owner wants them back. See [[Open questions]].

## Era 2: the rebuild (Oct 6, 2026)
| PR | What happened |
|---|---|
| #8 | **Rebuild from scratch:** React + Hono + PostgreSQL (schema `rigo`), own auth, server-side permissions, versioned workflows, deterministic invoices. The old `public.rigo_*` tables are left unused. |
| #9 | Design skills and a command allow list for Claude sessions |
| #11 | Prompt library: `/feature`, `/screen`, `/fix`, `/review`, `/ship`, `/new-prompt` |
| #12 | **"Light command center" redesign** of every screen: black chrome, red accent, Geist, live dispatch timeline, command menu |
| #10 | **Round 1 of the user critique:** sign-in bounce fixed, password recovery without email (owner reset links), sign-in limits, password rule, email typos, account management, landing page |

"Round 1" implies more critique rounds to come; each round's findings should be dropped into `Raw` and folded in here.

## Related
- [[Status - built, simulated, blocked]] · [[Rigo overview]]
