# Rigo employee invitations

GitHub `main` is the production source for the existing Vercel project. Commits
trigger Vercel deployments. There is no additional deployment service to install.

## Activate shared access

The app retains browser-local mode until all five server environment variables
are present. Invitations stay disabled in that mode; it never reports a fake send.

1. In the Supabase project, run `supabase/schema.sql` in the SQL editor.
2. Create/confirm the owner's Supabase Auth user and copy its user UUID.
3. Add these **Production** environment variables in the existing Vercel project:
   - `SUPABASE_URL`: the project's HTTPS URL.
   - `SUPABASE_ANON_KEY`: the public anon API key (not a secret/admin key).
   - `SUPABASE_SERVICE_ROLE_KEY`: the project's server-only service-role key.
   - `RIGO_OWNER_USER_ID`: the owner's confirmed Supabase Auth user UUID.
   - `RIGO_APP_URL`: the canonical production HTTPS origin, without a trailing slash.
4. In Supabase Authentication > URL Configuration, set Site URL to that origin
   and add `https://YOUR-DOMAIN/?invite=1` to the redirect allowlist.
5. Configure custom SMTP in Supabase Authentication. Supabase's default mail
   service restricts recipients and is unsuitable for invitations to any email.
   Keep invitation and recovery templates linked to `{{ .ConfirmationURL }}`.
6. Redeploy Vercel after setting the environment variables. Sign in as the owner
   from the browser holding the existing records. Choose **Use this browser's
   existing records** to import them once into shared storage. Keep a downloaded
   backup beforehand. Other browsers' local records are not merged automatically.
7. In App settings > Permissions > People & access, enter the email supplied by
   the employee, select their role, and click **Send invitation**. The email can
   belong to any provider; there is no company-domain restriction. Employees
   open their email link, set a password, and use that same email to sign in.

An existing Supabase user receives a login link and may set a new password.
The owner can resend an expired/failed invitation or remove membership. Sends
are throttled to once per employee per minute, in addition to Supabase limits.
Email acceptance by Supabase means **Invitation sent**, not guaranteed inbox
receipt; SMTP delivery/bounces are managed by the configured mail provider.

For a **Field employee**, link their Team row's account email to the invited
address. This determines which assignments they can see and update. Other
employees' assignments and billing history are filtered on the server.

## Employee self sign-up and approval

Employees can also create their own account instead of waiting for an invitation.

1. In Supabase Authentication > Providers > Email, keep **Enable email signups**
   and **Confirm email** turned on. Add `https://YOUR-DOMAIN/` to the redirect
   allowlist (the confirmation link returns there).
2. The owner opens **Access requests** (bottom-right button after signing in)
   and clicks **Copy sign-up link** (`https://YOUR-DOMAIN/?signup=1`). Share it
   by text, email, or a QR code.
3. The employee creates an account, confirms their email, and signs in. Their
   request appears in the owner's **Access requests** list. Until it is
   approved they see a "Waiting for approval" screen and no business data.
4. The owner chooses a role and clicks **Approve** (no email is sent; access
   is tied to that verified account) or **Decline**. Declined or removed
   employees cannot re-request; the owner can still invite them by email.
5. For a **Field employee**, link their Team row's account email as above.

Signing up alone never grants access. Approved members appear in People &
access and can be removed there as before.

## Install as a phone app

The app includes a web app manifest and icons. On iPhone, open the site in
Safari, tap Share > **Add to Home Screen**. On Android, open it in Chrome and
choose **Install app** / **Add to Home screen**. It then opens full screen with
its own icon, signed in as that employee, showing only what their role allows.

## Architecture and checks

`rigo-access.js` provides sign-in, recovery, invitation password setup, session
refresh, and the server transport. `api/rigo.js` serves the existing app actions.
`lib/server.cjs` verifies Supabase users, enforces membership, sends invitations,
and saves shared state using version checks. The service-role key stays on the
server. The workspace table has RLS and grants no direct client access.

`lib/domain.cjs` is generated from the standalone app's existing business rules
by `npm run build`. Both server and browser use those rules. Keep the extractor
in sync if replacing/rebuilding the bundled `index.html`.

Run `npm test` and `npm run build` before publishing. Verify the Vercel status on
the resulting GitHub commit. Then exercise an actual invitation with a test
employee email: inbox receipt, password setup, role access, and removal. Live
mail delivery cannot be verified without the connected project and SMTP.

Photos are stored as validated data URLs in shared job records (700 KB maximum
per upload). A large workspace may need private object storage later. Existing
payments, GPS, customer portal, and external notifications remain separate
integrations.
