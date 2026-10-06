# PR #6: Platform milestones A–F and G groundwork: companies, demo, operations, automation, templates, sharing

https://github.com/RigoM7/Rigo-App/pull/6 · state: closed · merged: 2026-10-06T01:55:18Z

## Summary
This PR delivers the platform roadmap through Milestone F, plus the groundwork for Milestone G. Each milestone was tested before the next began. `docs/PLATFORM.md` has full details for each one: what changed, the decisions made, the migrations, the verification, and the owner decisions still open.

- **A: companies.**
  - Personal accounts with several companies each, invitations, multiple owners, and owner/administrator authority.
  - Server-side checks on every request.
  - A company picker and switcher, with each browser tab bound to its own company.
  - Follow-ups: 10 new companies per account per day; a per-company owner switch for paid address lookup; a hint when a field employee isn't linked to a Team record.
- **B: isolated demo.** A fictional fuel, portable-toilet and septic company that runs only in the browser.
  - It makes no server or third-party calls.
  - It offers role preview, reset, and examples of the automation modes.
  - "Create my company" copies structure only, and the server builds it.
- **C: operations.**
  - Requested, actual, billable and equipment quantities are kept separately.
  - Billing a different quantity needs an owner or administrator and a reason.
  - Work without a price shows "Needs a price" and needs a confirmed, audited price before invoicing. Nothing is invoiced at $0.
- **D: Today and automation.**
  - A Today dashboard, and "My work today" for drivers.
  - Owners choose Manual, Assisted or Automatic, per process, with pause.
  - Approval rules bound to the exact proposal, never approved because time passed.
  - Reported problems with escalation.
  - Recurring service with idempotent visit planning.
- **E: setup and messages.**
  - One validated configuration model that visual tools, templates and browser AI assistants share. Every change is reviewed before it applies.
  - Private and selected-people templates, versioned, with no silent updates.
  - A customer message outbox. Nothing is sent: no email or SMS provider is connected.
  - Duplicate warnings in imports.
- **F: sharing.**
  - Explicit sharing agreements between companies, needing authority on both sides.
  - Shared records are read-only and copied only on request, and either side can revoke.
  - Money is never shared.
  - An "All my companies" view that keeps each company's money separate.
- **G groundwork, approved with billing off.**
  - The app opens offline from its own files only; company data and sign-in are never cached.
  - The manifest is store-ready, and `docs/DISTRIBUTION.md` covers publishing.
  - Plan and usage are shown, with a free early-access plan.
  - Paid lookups are counted per company, with an optional monthly cap.

## Database
Five additive migrations, all already applied in production (listed in `docs/PLATFORM.md`). The live company's data checksum and version (60) are unchanged. The current production code ignores the new tables until this merge.

## Off until the owner sets them up
- Email/SMS sending.
- The AI setup assistant.
- Paid address lookup for new companies.
- Billing and charging.
- App-store publishing.

## Tests
- `npm test`: 89/89. This includes database and server tests that run the real migrations on a local PostgreSQL, with simulated Supabase and Mapbox. No production or live-provider calls are made.
- Browser suites, all passing: `browser`, `group1`, `groups234`, `companies`, `demo`, `operations`, `today`, `setup`, `sharing`, `pwa`.

Screenshots are in `docs/screenshots/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01NJzVeQfq2X9E2u8VAHicLS
