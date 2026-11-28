# Claim email notifications

MoneyLai queues an email to the claimant when a Treasurer approves a claim or records a completed external payment. Approval means **awaiting payment**; the payment email says the Treasurer has recorded payment. MoneyLai does not transfer money or verify bank settlement.

## Setup

1. Existing databases: apply `supabase/migrations/017_claim_email_notifications.sql` once in Supabase SQL Editor after migration 016. Fresh projects: use the regenerated `SETUP_FRESH.sql`. Existing history is not emailed.
2. Use a dedicated Gmail sender. Enable Google 2-Step Verification and generate an [App Password](https://support.google.com/accounts/answer/185833?hl=en). Some account/organisation policies do not offer App Passwords. Use the app password, not the normal Google login password.
3. Set server environment variables from `web/.env.example`: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `APP_URL`, `CRON_SECRET`, plus the existing Supabase URL and service-role key. Use the deployed HTTPS origin for `APP_URL`. Restart/redeploy after configuration. Never put credentials in browser variables or source control. Supabase Auth SMTP configuration is separate from these claim notifications.
4. Configure your hosting scheduler to call `GET https://YOUR_SITE/api/notifications/dispatch` every minute with `Authorization: Bearer YOUR_CRON_SECRET`. This application does not automatically create a hosting scheduler. Each call handles up to five emails; configure a request duration supporting the route's 180-second maximum. Use a scheduler frequency supported by your hosting plan. No credentials belong in the URL.
5. The browser requests an immediate dispatch after a successful approval/payment; the server runs delivery after responding. The scheduler is required for reliable recovery when that request is interrupted or Gmail is unavailable. With missing configuration, messages stay pending and the scheduler returns 503.

SMTP uses Gmail's TLS endpoint `smtp.gmail.com:465`, following [Google's SMTP guidance](https://developers.google.com/workspace/gmail/imap/imap-smtp) and [Nodemailer's Gmail guide](https://nodemailer.com/guides/using-gmail). Hosting must allow outbound SMTP. Gmail's sending limits and security checks still apply; provider acceptance does not prove inbox delivery.

## Behaviour and operations

- The database transaction saves financial state and its outbox entry together. No Gmail call runs within that transaction. Mail failures do not revert approvals or payments.
- The recipient is resolved server-side from the claimant's current confirmed Auth email. Clients cannot supply recipients, amounts or email bodies.
- Messages contain the claim number, activity, amount and a sign-in link. Payment messages add the recorded payment date/reference. They exclude bank account details, receipts and payment proofs.
- Queued approval messages are cancelled when approval is revoked or payment is recorded, to avoid stale “awaiting payment” messages. A message already being accepted by SMTP cannot be recalled.
- Event uniqueness and atomic ten-minute leases prevent ordinary duplicate/concurrent sends. Failed sends back off up to one hour. A crashed worker is recoverable after its lease expires. SMTP cannot guarantee exactly-once delivery: a crash after provider acceptance but before saving success can cause a duplicate. A stable Message-ID is reused on retries.
- Only the server service role can read the outbox or lease/finish notifications. The immediate endpoint requires an active Treasurer session and same-origin request; the scheduler requires its bearer secret.
- Inspect `public.claim_email_notifications` in Supabase as the project owner: `status`, `attempts`, `available_at`, `sent_at`, `last_error`. Errors are intentionally generic; do not log provider credentials or recipient details. Persistent failures retry until configuration/recipient problems are resolved.

## Acceptance check

Use test accounts and an inbox you control. Approve a submitted claim and check the approval wording/link. Record payment with proof and verify amount/date/reference. Retry payment and confirm no second outbox event. Temporarily remove Gmail configuration and check financial success plus pending delivery; restore it and run the protected scheduler. Test revoked approval, unauthorised endpoint access and a foreign-origin POST. These live checks require configured Gmail, Supabase and hosting; local mocked tests do not establish real delivery.
