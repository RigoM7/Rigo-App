# PR #10: Round 1: fix sign-in, password recovery, accounts and the front page

https://github.com/RigoM7/Rigo-App/pull/10 · state: closed · merged: 2026-10-06T15:19:21Z

Fixes every problem found in Round 1 of the Rigo user critique: first impression, sign-up, sign-in and password recovery. Each bug was reproduced with a failing test first, then fixed. The branch also carries two earlier `.claude/`-only commits that this PR already held: the `design-md` skill and the bypass-mode note in `CLAUDE.md`.

## What changed

### C1: the first sign-in no longer bounces back to an empty sign-in page
- **Root cause:** a cached "signed out" answer outlived sign-in, because nothing was observing it. Sign-in, sign-up, reset, accepting an invitation, the demo, creating a company and changing email now load the signed-in person before navigating (`refreshMe`).
- **Sign-out:** forgets everything cached on the device (`signOutAndForget`), so the next person on a shared phone sees nothing.
- **Already signed in:** `/signin` and `/signup` send you to `?next=` (same-site paths only) or Workspaces. This also fixes m4.

### C2: a forgotten password can be recovered without email
- **Recovery page:** `GET /api/auth/recovery` tells the page what works before anyone types. With no email service, the page goes straight to the alternatives.
- **Owner reset links (new):** Team → **Reset link**.
  - Needs `members.manage`. Only owners can make one for an owner, and nobody can make one for themselves.
  - Other companies and non-members get 404.
  - The link works once, lasts 24 hours, is audited and notifies the other owners. It is shown once in a dialog with a copy button.
  - In the demo it's labeled Simulated, and no real link is created.
  - Using the link signs the person out of their other devices and signs them in here.
  - Migration `002_account_recovery.sql` adds `issued_by` and `company_id` to `password_resets`.
- **Safety re-check on use:** the person must still belong to the company and the creator must still be allowed. Links are refused for anyone who also belongs to, or is invited to, another company, so one company's managers can't reach another company through them. The security review found this gap; it's fixed and tested.
- **Support address:** optional `RIGO_SUPPORT_EMAIL`. If it's not set, that sentence is left out.
- **One email path:** reset, invitation, confirmation and email-change emails all go through `sendSystemEmail`. A provider plugs into `PROVIDERS` behind `RIGO_EMAIL_PROVIDER`.
- **Wording:** "installation" is gone from every customer-facing screen.

### M1: sign-in lockout
- Only failed sign-ins count. The limit is 10 per 15 minutes per email + device address, plus 100 per address across accounts.
- A successful sign-in, a reset or a password change clears the count.
- The message names the wait, sends a `Retry-After` header and links to reset. A warning appears with 3 or fewer tries left. Old records are cleaned daily.
- `X-Forwarded-For` is trusted only on Vercel, which overwrites it, or with `RIGO_TRUST_PROXY=1`.

### M2: password rule
- `src/shared/password.ts`, used at sign-up, reset and change.
- Rejects the 10,000 most common passwords (SecLists, MIT; the list stays on the server in `src/server/lib/common-passwords.ts`), repeated characters, sequences, keyboard rows, and the person's name or email.
- Plain error text and a "three or four unrelated words" hint. Existing accounts keep working.

### M3: email typos, confirmation, change and deletion
- **Typos:** sign-up and change-email suggest a fix for domain typos ("Did you mean …@gmail.com?"). It never blocks.
- **Confirmation:** `email_verified_at` and a single-use 7-day link, with a quiet notice and Resend on Workspaces and Account. It's never required, and it's hidden where email can't be sent.
- **Change email on Account:** needs the password and refuses an address already in use.
  - With email, a link to the new address completes the change and the old address is told.
  - Without email, the change happens at once.
  - Either way: other sessions are revoked, it's audited, and invitations to the new address appear.
- **Delete account:** done safely with the current foreign keys. It needs the password and is refused for the last owner of a company. Memberships end and open jobs return to the queue, the demo is deleted, sessions and links are revoked, and the user row is anonymized so company history stays intact.

### M4: a front page that explains Rigo
- `/` for signed-out visitors: names fuel delivery, portable toilets and septic, says "Free to start", and offers **Create a free account** and **Try the demo** (sign-up, then straight into the demo).
- What Rigo does for the office, drivers and owners, beside real screenshots of the demo. They come in light and dark, are optimized WebP with width and height set, load lazily below the fold, and are labeled as demo data. `scripts/landing-shots.mjs` regenerates them.
- An honest "What Rigo doesn't do yet" list: customer email and texts, card payments, maps, AI. No testimonials, logos or invented numbers.
- Signed-in visitors still go straight to Workspaces.

### Minor fixes
- **m1:** a global zod error map gives plain messages such as "Use 80 characters or fewer.". Every form input carries `maxLength` matching the server limit.
- **m2:** a successful reset signs you in: "Password changed. You're signed in."
- **m3:** reset and email links are checked on load (`GET /api/auth/reset/:token` and `/api/auth/email-token/:token` return valid or invalid only). Used links say so and offer a new one.
- **m5:** tab titles read "Page · Company · Rigo", with "(Demo)" in the demo.
- **m6:** plain language throughout. "Simulated mailbox" appears only on the local mailbox and the local-only hint.
- **m7:** on Workspaces, "Create a company" stays primary and the demo is secondary with "Not sure yet?…". Optional `RIGO_TERMS_URL` and `RIGO_PRIVACY_URL` add the agreement line at sign-up.
- **m8:** a full-width "Create a free account" button (44px or taller) under "New to Rigo?". "Forgot your password?" keeps a 24px target.

### Build fix (second push)
The first push failed the Vercel build with `Could not resolve "../data/common-passwords.js"`. `.gitignore` ignored every folder named `data/`, so the password list was never committed. Local runs passed only because the file existed on disk.

The rule now covers only the top-level runtime `/data/` folder, and the list moved to `src/server/lib/`. The same rule had also dropped the data folders of three skills added earlier (`design`, `design-system`, and Impeccable's font index), so those are now committed too.

Checked from a clean clone of the fixed commit: the Vercel output builds, the typecheck is clean, and `npm test` passes 63/63. The same clean-clone build of the previous commit reproduced the error.

## Screenshots (before → after)
The forgot page is shown on the copy with no email service, which is how the live site behaves.

| | Before | After |
|---|---|---|
| Landing `/`, desktop | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-landing-desktop.webp?raw=true" width="360"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-landing-desktop.webp?raw=true" width="360"> |
| Landing `/`, 390px | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-landing-390.webp?raw=true" width="180"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-landing-390.webp?raw=true" width="180"> |
| Sign in, desktop | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-signin-desktop.webp?raw=true" width="360"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-signin-desktop.webp?raw=true" width="360"> |
| Sign in, 390px | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-signin-390.webp?raw=true" width="180"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-signin-390.webp?raw=true" width="180"> <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-signin-paused-390.webp?raw=true" width="180"> |
| Forgot (no email), desktop | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-forgot-noemail-desktop.webp?raw=true" width="360"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-forgot-noemail-desktop.webp?raw=true" width="360"> |
| Forgot (no email), 390px | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-forgot-noemail-390.webp?raw=true" width="180"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-forgot-noemail-390.webp?raw=true" width="180"> <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-forgot-email-390.webp?raw=true" width="180"> (with email) |
| Reset link (used or invalid), desktop | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-reset-desktop.webp?raw=true" width="360"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-reset-desktop.webp?raw=true" width="360"> |
| Reset link, 390px | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-reset-390.webp?raw=true" width="180"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-reset-390.webp?raw=true" width="180"> |
| Account, desktop | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-account-desktop.webp?raw=true" width="360"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-account-desktop.webp?raw=true" width="360"> |
| Account, 390px | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/before-account-390.webp?raw=true" width="180"> | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-account-390.webp?raw=true" width="180"> |
| Team: reset-link dialog (new) | n/a | <img src="https://github.com/RigoM7/Rigo-App/blob/6e222b07f12bb1901c74e08fe5e344be9c0ac9f7/docs/screenshots/round1/after-team-reset-link-desktop.webp?raw=true" width="360"> |

## Checks
- **Typecheck:** `npm run typecheck` is clean.
- **API tests:** `npm test` passes 63/63 on PGlite and 63/63 on PostgreSQL 16. The new file is `test/accounts.test.ts`, with 26 tests. Run against the old code on `main`, 21 of the new tests fail, including "successful sign-ins never lock an account". The rest pass on both: checks of the new helpers on their own, existing weak passwords still signing in, and the re-check case, which was added later and wasn't part of the run on `main`. All 26 pass on this branch.
  - **C1:** sign-in and sign-up return the `/auth/me` shape.
  - **M1:**
    - 12 successful sign-ins never lock;
    - 10 failures lock that email on that address only, with the wait time, `Retry-After` and a warning at 3 left;
    - another address still signs in;
    - a success or a reset clears the count;
    - the per-address limit;
    - cleanup of old records.
  - **M2:** each rejected example (`aaaaaaaaaa`, `password123`, `1234567890`, `qwertyuiop`…), a strong phrase accepted, the same rule on reset and change, and weak existing passwords still sign in.
  - **C2:**
    - recovery methods with and without email;
    - an owner can create a link, while dispatcher, driver and office can't;
    - a non-owner can't target an owner;
    - another company gets 404;
    - a link works once, expires, and signs out existing sessions;
    - a link is refused for someone in, or invited to, another company;
    - a link is re-checked when used;
    - the demo link is simulated and makes no external call.
  - **M3:**
    - typo suggestions;
    - a confirmation link works once and expires;
    - change email: wrong password, address taken, session revocation, invitation matching;
    - immediate change without email;
    - account deletion, and the sole-owner refusal.
  - **m1 and m3:** no API message uses developer wording; the error map covers the common schema types; link checks reveal nothing.
- **Browser checks:** `e2e/run.mjs` passes 51/51, run against a local copy and a production-like copy with no email (`NOEMAIL_URL`).
  - **C1:** from `/`, from sign-up, from bookmarked `/workspaces` and `/c/<demo>/today`, and switching users in one tab, all at 1440px and 390px. 6 of these 8 failed before the fix.
  - **Landing:** content, redirect when signed in, and "Try the demo".
  - **Sign-in screens:** the lockout warning and pause, the typo suggestion, invalid links, the forgot page on the no-email copy, tab titles and target sizes.
  - **Accessibility:** axe with no violations on the landing, sign-in, sign-up, forgot, reset (valid and invalid), workspaces and account pages and the Team reset-link dialog, in light and dark, plus the existing 18 app pages.
  - **Layout:** no horizontal overflow at 375, 768, 1024 and 1440px, or at 200% text.
- **Walkthrough S1 at 390px on both copies** (automated in `e2e/run.mjs`): Dana arrives at `/`, signs up with a `gmial.com` typo and gets the suggestion, reaches Workspaces in one try, fixes the email on Account, joins her employer, signs out, forgets the password, and recovers it by the mailbox (local) or by an owner's reset link (no-email copy). There's also a separate check that 10 successful sign-ins in a row never lock the account.
- **Security review** (security-review skill on the whole diff): no findings at the reporting bar. The two gaps it raised in the new reset-link feature are fixed and tested: a link wasn't re-checked when used, and pending invitations elsewhere weren't counted.
- **Impeccable detector:** run on the changed screens. Its five warnings are all in existing CSS from the redesign (width transitions, the demo hazard edge, timeline status edges), not in this change.

## How to verify
1. `npm ci && npm run build`.
2. Start the local copy: `APP_URL=http://localhost:8787 npm start`.
3. Start the live-like copy with no email: `NODE_ENV=production PORT=8788 RIGO_DATA_DIR=data/prodlike APP_URL=http://localhost:8788 npm start`.
4. Run `npm test` and `NOEMAIL_URL=http://localhost:8788 BASE_URL=http://localhost:8787 NODE_PATH=$(npm root -g) npm run test:browser`.
5. By hand at 390px:
   - **Local copy (8787):** open `/`, create an account with a `@gmial.com` address and take the suggestion. Then sign out, use "Forgot your password?", and open the link from `/dev/mailbox`.
   - **No-email copy (8788):** as an owner, invite a driver. Then use Team → Reset link and open that link in a private window.

## Owner decisions (nothing here is blocked on them)
1. **Email service** for reset, invitation and confirmation emails. Until then, owner reset links and the support contact cover recovery.
2. **Support email address** for `RIGO_SUPPORT_EMAIL`. It isn't set, so the forgot page leaves out the "If you're the only owner, email …" line.
3. **Terms of service and privacy policy**, and their URLs for `RIGO_TERMS_URL` and `RIGO_PRIVACY_URL`. Until they're set, sign-up shows no agreement line.
4. **Deleting accounts** is built, not deferred. If you'd rather not offer it yet, say so and I'll hide it.

## Notes
- Owner-created reset links rely on trusting the company's managers: whoever holds the link can set that person's password until it's used. This is documented in `docs/IMPLEMENTATION-STATUS.md`.
- On non-production local copies, the sign-up limit per address is raised from 20 to 500 an hour so the browser checks can run. Production keeps 20.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Xp2EqZUToyNw5BBzm2xeTX
