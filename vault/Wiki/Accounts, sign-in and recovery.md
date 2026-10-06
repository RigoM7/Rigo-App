---
type: topic
updated: 2026-10-06
sources: ["[[PR 10 Round 1 - fix sign-in, password recovery, accounts and the front page]]", "[[repo IMPLEMENTATION-STATUS (2026-10-06)]]", "[[repo README (2026-10-06)]]"]
---
# Accounts, sign-in and recovery

Rigo runs its own auth (no Supabase Auth): random 256-bit session tokens stored as SHA-256, httpOnly SameSite=Lax cookies, bcrypt cost 12, and a CSRF header check (`x-rigo`).

## Rules (as of Round 1, PR #10)
- **Sign-in lands on the right page the first time** from any entry point. Root cause of the old bounce: a cached "signed out" answer outlived sign-in. Fixed with `refreshMe` before navigating.
- **Sign-out forgets everything cached** on the device (`signOutAndForget`), for shared phones.
- **Sign-in limits:** only failed sign-ins count: 10 per 15 minutes per email + device address, plus 100 per address across accounts. Success, reset or password change clears them. The message names the wait and links to reset; a warning shows at 3 or fewer tries left.
- **Password rule** (`src/shared/password.ts`): 10+ characters; rejects the 10,000 most common passwords, repeats, sequences, keyboard rows, and the person's name or email. Hint: "three or four unrelated words".
- **Email typo suggestions** (gmial.com → gmail.com), never blocking.
- **Email confirmation** is optional; nothing is blocked on it.
- **Change email** needs the current password. **Delete account** needs the password and is refused for the last owner of a company.

## Recovery without an email service
There's no email provider yet (see [[Open questions]]), so on the live site:
- An owner (or anyone with `members.manage`) creates a **reset link** from Team. Single use, 24 hours, audited, other owners notified, shown once. Only owners can make one for an owner; nobody for themselves.
- Links are refused for anyone who also belongs to, or is invited to, another company, so one company's managers can't reach into another company.
- Optional `RIGO_SUPPORT_EMAIL` for owners with no other owner.
- All account email (reset, invitation, confirmation, email change) goes through `sendSystemEmail`; a provider plugs into `PROVIDERS` behind `RIGO_EMAIL_PROVIDER`.
- Locally, emails appear in the simulated mailbox at `/dev/mailbox`.

Copy rule: the word "installation" never appears on customer-facing screens.

## Related
- [[People, roles and access]] · [[Status - built, simulated, blocked]] · [[Project history]]
