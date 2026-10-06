---
type: decisions
updated: 2026-10-06
sources: ["[[repo IMPLEMENTATION-STATUS (2026-10-06)]]", "[[repo PRODUCT-VISION (2026-10-06)]]", "[[Project history]]"]
---
# Open questions

Decisions that belong to the owner. When one is decided, record the answer here with the date, then update the affected notes.

## Blocked on the owner (from the status ledger)
- [ ] **Email service:** which provider? Unblocks password reset by email, invitations, email confirmation and customer emails. Plugs into `PROVIDERS` behind `RIGO_EMAIL_PROVIDER`.
- [ ] **Support address** for owners with no other owner: set `RIGO_SUPPORT_EMAIL`.
- [ ] **Terms of service and privacy policy:** publish them, then set `RIGO_TERMS_URL` and `RIGO_PRIVACY_URL`.
- [ ] **Real AI answers:** turn on with `RIGO_AI_PROVIDER=anthropic` and an `ANTHROPIC_API_KEY`?

## Product direction
- [ ] **Pricing:** monthly charging is a future direction; no price chosen.
- [ ] **Background work on Vercel:** stay with request-time + daily cron, or add a dedicated worker / more frequent cron (paid plan)?
- [ ] **Era 1 ideas to bring back?** Sharing agreements between companies, "All my companies" view, paid address lookup with caps, separate billable quantities with an owner reason. See [[Project history]].
- [ ] **Next build order:** the ledger lists email adapter, configurable dashboard widgets and job stages, XLSX import, map links/geocoding, finer per-field permissions.
- [ ] **Critique Round 2:** what's in scope?

## Related
- [[Status - built, simulated, blocked]]
