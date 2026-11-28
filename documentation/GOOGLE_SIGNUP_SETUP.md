# Google registration setup

## User flow

Login > **Apply to join with Google** > **Continue with Google** > **Submit membership application** > wait for President approval > set a MoneyLai password > enter the workspace. After activation, either Google or email/password signs in to the same member account. This never changes the user's Google password.

The President reviews applications in **Members > Membership applications** and records a reason. Rejected applicants see that reason; the President can reconsider them. Unused approvals can be revoked. After activation, use Disable account to remove access. Existing email invitations and members remain supported.

Status refreshes automatically while the page is visible, and users can return later with Google or click Refresh status. Approval emails are not sent by this feature.

## 1. Database

For an existing database already on migration 015, run **only** `supabase/migrations/016_google_membership.sql` in Supabase SQL Editor, once. Apply any missing earlier migrations first, in order. Do not rerun `SETUP_FRESH.sql` or role bootstrap on an existing deployment.

Fresh empty projects may use the regenerated `supabase/SETUP_FRESH.sql`, including migration 016. Existing accounts keep their roles, status and financial records. New identities remain unactivated until President approval AND successful password setup; approval alone provides no business access.

## 2. Google Cloud

Follow the [official Supabase Google guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

1. Configure MoneyLai app branding, audience and contact details in Google Cloud / Google Auth Platform.
2. Create an OAuth client with type **Web application**.
3. Add the website origin under Authorized JavaScript origins, for example `https://YOUR_WEBSITE` and `http://localhost:3000` for local development.
4. In Authorized redirect URIs, paste the exact callback shown in **Supabase Authentication > Sign In / Providers > Google**, normally `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. This is the Supabase callback, not the website's `/auth/callback`.
5. Save the Client ID and Client Secret. If the Google app is in Testing mode, add the Google accounts used for testing to Test users. Configure audience/publishing appropriately before inviting the club.

## 3. Supabase Auth

1. Enable Google and enter the Google Client ID and Client Secret in its provider settings. Do not place the Client Secret in browser code or `NEXT_PUBLIC_*` variables.
2. Allow new user signups so new Google users can obtain an identity. Database membership rules still block unapproved users. Keep normal email verification protections enabled.
3. Keep email/password sign-in enabled.
4. Set Site URL to the deployed website origin. Add these entries to the redirect allowlist, replacing the placeholders and local port as needed:

   ```text
   https://YOUR_WEBSITE/auth/callback?next=/membership
   http://localhost:3000/auth/callback?next=/membership
   ```

   Keep existing invitation and password recovery redirect entries.

Existing members should select the same email as their MoneyLai account. Supabase provides [automatic same-email identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking). Test existing accounts on your configured project before release; do not delete or recreate them to enable Google.

## 4. Deployment

Deploy the updated `web` application after applying the migration. Keep the current Supabase URL, publishable key and server-only `SUPABASE_SERVICE_ROLE_KEY` configured on the host. The server-only key is needed for password setup and activation. No new application environment variables or dependencies are required.

## 5. Live acceptance test

Use separate browser profiles for the applicant and President.

1. New Google user submits an application and sees the waiting page. Repeated submissions must not create duplicates.
2. Before approval, opening Dashboard, claims and receipts must not expose club data.
3. President approves the application; Member and Treasurer accounts cannot approve it.
4. Applicant sees password setup, but still has no business access until activation succeeds.
5. Set a MoneyLai password, sign out, and test both password and Google login. Both must reach the same member identity and records.
6. Reject another application and check its reason. Revoke another approval before activation and check that activation is blocked.
7. Disable an activated member and verify both login methods remain blocked from business data.
8. Existing password member uses Google with the same email: verify the user ID, role and claims are retained. Also test old invitation and password recovery flows.

Local tests stub Auth identity and Storage infrastructure. They do not verify Google credentials, consent screens, redirect settings, live identity linking or hosted email delivery.

## Local checks

From `web`, run `npx next typegen`, `npm run typecheck`, `npm run test:members`, `npm run test:login`, `npm test`, `npm run test:database`, and `npm run build`.

If Windows prevents Turbopack from creating directory junctions, use `npm run build -- --webpack` to verify with the bundled Webpack builder.

## Verification on 27 November 2026

Passed route type generation, TypeScript checking, 20 membership tests, 5 login tests, 17 domain/live-sync tests, 31 database workflow/security checks, the fresh-install test, ESLint on changed source/test files, and the Webpack production build.

The default Turbopack build encountered a Windows junction permission error. Repository-wide lint still reports 16 CommonJS import errors in existing `.cjs` tests and three unrelated warnings. No remote migrations, Google provider settings or deployments were changed. Live Google sign-in and same-email account linking still require the acceptance check above.
