# MoneyLai

A university club budget and expense reimbursement web application built for the AIROST internship project. MoneyLai connects membership approval, Member expense submission, Treasurer review and payment recording, and President financial oversight in one role-controlled workflow.

It includes optional Gemini receipt assistance, item-level claim allocation, clarification requests, duplicate-receipt warnings and downloadable activity reports. MoneyLai records reimbursements made outside the application; it does **not** transfer money or automatically approve claims.

- **Repository:** [GitHub source](https://github.com/JLeongXD/AIROST2627_MoneyLai)
- **Live website:** [Open MoneyLai](https://airost-2627-money-lai.vercel.app/)
- **Pitch deck:** [View presentation](https://airost-2627-money-lai.vercel.app/slide) | [HTML source](web/public/moneylai-deck.html)
- **Latest documentation:** [Web/App project document](documentation/NEW/MoneyLai_Project_Documentation.docx) | [Technical document](documentation/NEW/MoneyLai_Technicial_Documentation.docx)

## Reviewer demo access

Reviewers can visit the [MoneyLai login page](https://airost-2627-money-lai.vercel.app/login) and use the following demo credentials to try the application:

| Email | Password |
| --- | --- |
| [president@example.com](mailto:president@example.com) | `12345678` |
| [treasurer2@example.com](mailto:treasurer2@example.com) | `jl12345` |
| [treasurer2@example.com](mailto:treasurer2@example.com) | `12345678` |

The credentials are listed as provided. Two password options were supplied for `treasurer2@example.com`; try each option when signing in. Use fictional data during the review.

## Features and roles

Google registration supports President approval: apply with Google, wait for approval, then set a MoneyLai password to activate. Active members can use Google or email/password; existing email invitations remain supported. Follow [Google registration setup](documentation/GOOGLE_SIGNUP_SETUP.md) before production use. Migration 016 and Google/Supabase configuration are required.

| Role | Main capabilities |
| --- | --- |
| Member | Maintain payout details; create and edit own drafts; upload receipts; submit, withdraw and revise eligible claims; answer information requests; track reimbursement. |
| Treasurer | Propose activities and budget changes; review other members' claims in an embedded review workspace; request information; approve/reject; record external payments with proof; export activity evidence packs. |
| President | Review membership applications; invite members; assign Member/Treasurer roles; disable or restore access; nominate a successor; approve/reject budget requests; inspect restricted financial summaries and claims; download summary packs without private receipts or bank details. |

Additional features:

- Guided expense entry and private JPG, PNG or PDF receipt previews.
- Optional receipt-first drafting: Gemini extracts one receipt with up to 100 item lines. Claim the whole receipt or select individual purchases, record their activity purposes, and confirm the final reimbursement. Tax, discount and rounding treatment is checked to avoid counting adjustments twice.
- Member-corrected reimbursement amounts with mandatory reasons and visible comparison against the AI-read total and automatic calculation. Corrections remain subject to Treasurer verification.
- Claim-versus-receipt AI checks with consent, outdated-result detection and manual review fallback.
- Potential duplicate detection using indexed file fingerprints and receipt details, with matching-claim links, statuses and a recheck action for review. A warning is not a finding of fraud.
- Budget shortfall notices show available activity budget, the claim amount and the difference during entry and review. Members may submit an over-budget claim, but the shortfall must be resolved before approval.
- Clarification requests and replies, with claim and activity audit histories.
- Gmail notifications for approved claims and recorded payments, with a durable retry queue. Follow [email notification setup](documentation/EMAIL_NOTIFICATIONS_SETUP.md); migration 017, sender credentials and a hosting scheduler are required.
- Excel, PDF and ZIP activity exports with role-specific evidence access.
- President overview with membership and budget queues, activity balances, budget-use alerts at 80% or higher, and follow-up on loaded claims awaiting review for seven days or more.
- Five-second polling, focus and connectivity-triggered refresh, operation feedback and sync status. This is not a WebSocket subscription or an offline-write queue.
- Desktop top navigation and mobile bottom navigation.

### Membership and responsibilities

- Google applicants submit a membership application and wait for President approval before setting a MoneyLai password and activating access. Approval alone does not grant access. The President can reject applications, reconsider rejected applications and revoke unused approvals; membership approval does not send an email notification.
- The President can also send or resend email invitations. The recipient opens `/join`, sets their own password and activates as a Member. Treasurer permissions are assigned separately.
- The Members page supports searching accounts, changing Member/Treasurer roles, and disabling/restoring access. Disabling an account blocks business-data access while retaining claims and financial history. Access changes require a recorded reason.
- President handover requires nomination and acceptance by the successor. The current President keeps the role until acceptance, then becomes a Member. A nomination can also be declined or cancelled.

### AI assistance and limits

Receipt reading and claim checking are optional, consent-based aids to human review. With migration 015 applied, both share an allowance of **100 requests per user in a rolling 24-hour period**, with a **30-second cooldown** between requests. Provider quotas and availability may impose additional limits. Saved receipt readings can be reused without starting a new extraction.

## Technology stack

| Layer | Technology |
| --- | --- |
| Application | Next.js 16.4.4 App Router, React 19.3.0, TypeScript |
| Styling | CSS and CSS Modules |
| Identity and persistence | Supabase Auth, PostgreSQL, RLS and controlled PL/pgSQL RPCs |
| Documents | Supabase private Storage buckets and signed URLs |
| Optional AI | Google Gemini, called by server Route Handlers |
| Claim notification email | Nodemailer with Gmail SMTP and a PostgreSQL delivery queue |
| Reports | ExcelJS, pdf-lib, @pdf-lib/fontkit and JSZip |
| Local database tests | PGlite embedded PostgreSQL |

## Local setup

### 1. Install dependencies

Use a Node.js version compatible with the installed Next.js release and preserve the committed lockfile.

```powershell
git clone https://github.com/JLeongXD/AIROST2627_MoneyLai.git
cd AIROST2627_MoneyLai/web
npm ci
```

### 2. Configure Supabase

Create a Supabase project or use the existing MoneyLai project. Database SQL is executed in **Supabase Dashboard > SQL Editor**, not by merely placing files in this repository.

**Fresh database only:** run [supabase/SETUP_FRESH.sql](supabase/SETUP_FRESH.sql). This file combines the ordered migrations. Never run it over an existing MoneyLai database.

**Existing database:** identify which migrations have already been applied and run only the missing migrations in order. Migrations are not a set of scripts to rerun indiscriminately. Back up important data before applying schema changes.

| Migration | Purpose |
| --- | --- |
| 001-005 | Initial activities, claims and draft operations |
| 006 | Complete workflow, profiles, receipts, payments, permissions and audit records |
| 007 | President role and restricted overview |
| 008 | President-reviewed activity/budget proposals |
| 009 | AI claim-check records and controlled AI operations |
| 010 | Clarification workflow and receipt fingerprint indexing |
| 012 | Activity exports and restoration of the claim-based budget model |
| 013 | Optional receipt-first drafting, confirmed allocation plans and revision history |
| 014 | Member invitations, access management and President handover |
| 015 | Shared rolling AI usage allowance |
| 016 | Google membership applications, President review and password activation |
| 017 | Transactional claim approval/payment email queue and protected delivery operations |

Migration 011 is retired and is not required for a fresh installation. Migration 012 can follow 010 or a deployment that previously applied the retired procurement migration. It disables the old procurement endpoints/guards while preserving historical data. The current application does not expose a procurement pre-approval workflow.

If migrations change, regenerate the fresh-install script from `web`:

```powershell
npm run db:generate-setup
```

This regenerates a **local file**; it does not apply SQL to Supabase.

### 3. Bootstrap roles and configure membership

For initial setup, create and confirm the initial President and Treasurer accounts through Supabase Authentication. New profiles default to the `member` role; business access also depends on membership status and activation.

Edit the example emails in [BOOTSTRAP_ROLES.sql](supabase/BOOTSTRAP_ROLES.sql), then run the script as the project owner to assign and activate the initial Treasurer and President accounts. This script is for initial setup or emergency recovery. Use the website's Members page for routine invitations, role changes and access management. Use a second Treasurer if a Treasurer needs to submit personal claims: a person cannot approve their own claim.

The application assumes one club with President-controlled membership. Google self-registration requires allowing new Auth signups; these identities have no business access until approved and activated. Follow [the Google setup guide](documentation/GOOGLE_SIGNUP_SETUP.md). Only designated assessment demo credentials may be published; do not commit production account passwords or real payout information as demo data.

For email invitations, configure Supabase Auth email delivery and allow the deployed `/join**` redirect, plus localhost for development. Invitation and recovery email templates must retain `{{ .ConfirmationURL }}`. Supabase Auth emails and the Gmail claim notifications below use separate delivery configuration.

### 4. Set environment variables

From `web`, copy the example file:

```powershell
Copy-Item .env.example .env.local
```

Configure the following values using [web/.env.example](web/.env.example):

| Variable | Location and purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key; database access still depends on RLS/RPC permissions |
| `GEMINI_API_KEY` | Server-only key for optional AI operations |
| `GEMINI_MODEL` | Server-only model identifier supported by your Gemini account |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged key for protected AI, receipt, export, member invitation/activation and notification operations |
| `APP_URL` | Canonical website origin used in claim-notification links; use the deployed HTTPS origin in production |
| `GMAIL_USER` | Server-only Gmail sender address for claim approval/payment notifications |
| `GMAIL_APP_PASSWORD` | Server-only Gmail App Password for the sender; not the regular account password |
| `CRON_SECRET` | Server-only bearer secret protecting scheduled notification dispatch |

Never prefix server credentials with `NEXT_PUBLIC_`, commit `.env.local`, or expose a service-role key to the browser. AI suggestions remain optional; manual claim entry and human review remain available when AI is unavailable. Export and receipt-assistance server routes require their corresponding database and server configuration.

### 5. Start the application

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with a configured account. To view the pitch deck locally, open [http://localhost:3000/slide](http://localhost:3000/slide); the presentation does not require sign-in.

### 6. Configure claim notification delivery

After migration 017, configure the Gmail sender with 2-Step Verification and an App Password, plus the server variables above. The hosting environment must allow outbound SMTP to `smtp.gmail.com:465`.

Configure an external scheduler to call `GET /api/notifications/dispatch` with `Authorization: Bearer <CRON_SECRET>`, ideally every minute where the hosting plan supports it. Each call processes up to five messages. The repository does not create a hosting scheduler automatically.

Approval and payment actions also request immediate dispatch, but the scheduler recovers queued messages after interruptions or delivery failures. Email failures do not undo financial actions. Follow [the email notification setup guide](documentation/EMAIL_NOTIFICATIONS_SETUP.md) for setup, retries and live acceptance checks.

## End-to-end demonstration

Before the expense workflow, use the initial President account to approve a Google membership application or invite a Member by email. Activate the Member account and assign Treasurer responsibility to a separate account through Members.

1. Treasurer proposes an activity and its budget; President reviews the request.
2. Member enters payout details in Profile, using fictional details for demonstrations.
3. Member selects an activity and enters an expense manually, or uses receipt assistance to claim the whole receipt or selected purchases, confirming purposes and reimbursement calculations.
4. Member saves the draft, checks attached originals and uploads any required receipt/supporting documents.
5. Member optionally runs AI checking with consent, reviews warnings and submits for human review.
6. Treasurer inspects the original documents, allocation, duplicate warnings and available budget. They approve, reject or request more information; Member can reply to an information request. Budget shortfalls must be resolved before approval.
7. After approval, Treasurer makes the bank/e-wallet transfer **outside MoneyLai**.
8. Treasurer records its date, reference and payment proof, confirming that the external transfer is complete.
9. Member checks reimbursement status and history. President reviews the restricted overview; permitted roles export the activity pack.

When notification delivery is configured, the claimant receives an approval email indicating that payment is pending, and a separate email when the Treasurer records payment. These messages do not verify bank settlement.

Eligible submitted claims can be withdrawn; rejected claims can be revised. Draft deletion and reversal of approval are subject to ownership, history and workflow rules. Previously submitted records are retained where required for traceability.

## Financial rules and security

- Currency is MYR. PostgreSQL numeric values and server-side validation govern financial decisions.
- Committed expenditure = Approved + Paid claim amounts.
- Available budget = activity allocation minus committed expenditure.
- Submitted claims do not reserve budget. Recording payment moves Approved to Paid without deducting the budget twice.
- An over-budget submission does not increase the activity allocation or bypass approval checks. Resolve the shortfall, including President-approved budget changes where needed, before approving the claim.
- Financial RPCs validate permissions and lock relevant records within transactions. A payment is unique per claim, and payment retry handling prevents a second payment record.
- RLS, Storage policies and controlled `ml_*` RPCs are the security boundary. Hiding an action in the UI is not authorization.
- Members cannot inspect other members' private claim evidence or payout details. President summaries do not confer Treasurer privileges.
- Receipts and payment proofs use private storage and short-lived signed links. Standard attachments support JPG, PNG and PDF, up to 5 MB per file and five receipt/supporting attachments per claim.
- Receipt-first item selection supports one receipt per claim. It allocates eligible items within an expense; it is not a multi-person reimbursement splitting feature.
- AI findings and duplicate warnings support human decisions. They are not automatic approvals, confidence guarantees or fraud verdicts.

## Activity exports

Treasurer activity packs include Excel, linked PDF reports and permitted original receipt/payment-proof evidence. President packs contain summaries and exclude private evidence and audit records.

The report generator limits an activity export to 1,000 claims, 200 evidence files, 5 MB per evidence file, 50 MB of original evidence and a 60 MB ZIP. Unsupported or damaged evidence may be noted in the manifest rather than fully embedded in the PDF; inspect reported issues and retained originals.

Export PDFs use the bundled Noto Sans SC font; retain its accompanying OFL license in `web/public/fonts`.

## Routes and source layout

| Route | Purpose |
| --- | --- |
| `/slide` | Public pitch deck; no sign-in required |
| `/login` | Sign-in and password recovery request |
| `/membership` | Google membership application, approval status and password activation |
| `/join` | Email invitation verification and Member password activation |
| `/members` | President-only membership applications, invitations, role/access management and handover |
| `/dashboard` | Member/Treasurer overview |
| `/activities` | Activity budgets, proposals and exports |
| `/claims` | Own claim list, search and filters |
| `/claims/new` | Manual or receipt-assisted draft entry |
| `/claims/[id]` | Evidence, AI checks, clarifications, decisions, payment and history |
| `/claims/[id]/edit` | Edit an eligible own draft |
| `/treasury` | Review/payment queues and embedded claim workspace |
| `/treasury/[id]` | Treasurer-only claim detail workspace |
| `/president` | Club overview, membership/budget queues, budget alerts and restricted claim summaries |
| `/profile` | Profile and payout details |
| `/update-password` | Password update after recovery |
| `/auth/callback` | Auth/recovery code exchange |

```text
web/src/
  app/              Next.js routes, styles and server API handlers
  features/         Named page implementations, grouped by feature
  components/       Shared navigation, receipts, AI, review and export UI
  lib/
    ai/             AI schemas, extraction, allocation and server helpers
    members/        Invitation verification, membership types and server helpers
    notifications/  Claim email rendering, queued delivery and retries
    reports/        Activity report generation
    supabase/       Browser/server Supabase clients
    api.ts          Authenticated queries, RPC and file helpers
    domain.ts       Shared validation and formatting
    live-sync.ts    Polling and connectivity refresh coordination
web/tests/          Unit, route and embedded-database tests
supabase/           Ordered migrations, fresh setup and role bootstrap
```

## Checks and tests

Run from `web` after `npm ci`:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:ai
npm run test:database
npm run test:exports
npm run test:receipts
npm run test:claim-flow
npm run test:treasury
npm run test:login
npm run test:members
npm run test:notifications
npm run build
```

| Command | Coverage |
| --- | --- |
| `npm test` | Domain validation and live-sync behavior |
| `npm run test:ai` | Claim comparison and mocked Gemini responses/failures |
| `npm run test:database` | Workflow/security migrations and setup checks |
| `npm run test:exports` | Report generation, export permissions and route behavior |
| `npm run test:receipts` | Receipt assistance, allocation, database and route behavior |
| `npm run test:claim-flow` | Claim submission, browser fetch handling and review UI behavior |
| `npm run test:treasury` | Treasurer review workspace and payment interface checks |
| `npm run test:login` | Login interface and authentication flow checks |
| `npm run test:members` | Membership permissions, invitations, activation and Google application flows |
| `npm run test:notifications` | Notification outbox/database rules and mocked email/dispatch behavior |

Database suites use local embedded PostgreSQL with test infrastructure; they are not live Supabase acceptance tests. AI tests do not establish that a real Gemini account has sufficient quota or that production receipt extraction succeeds. Membership and notification tests do not establish that live Google OAuth, identity linking, Supabase Auth emails or Gmail delivery work on the deployed project.

These commands are reproducible checks, **not a claim that they currently all pass**. [documentation/VERIFICATION.md](documentation/VERIFICATION.md) is an older, dated verification record; it does not verify every newer feature. Before release, rerun checks and test actual login, role restrictions, uploads, recovery email, AI, exports and reimbursement against the configured environment.

## Deployment

Suggested configuration for a Next.js-compatible host such as Vercel:

1. Import the GitHub repository and set the project root to `web`.
2. Configure the environment variables listed above in the hosting dashboard.
3. Apply only the missing Supabase migrations for the same application version.
4. Build with `npm run build` and deploy. If the host requires a start command, use `npm run start`.
5. Set Supabase Auth Site URL to the deployed origin and allow the production `/auth/callback` redirects for recovery (`?next=/update-password`) and Google membership (`?next=/membership`), plus `/join**` for invitations. Keep localhost redirects for local development if needed. Configure Google OAuth using [the setup guide](documentation/GOOGLE_SIGNUP_SETUP.md).
6. Configure Supabase Auth email delivery and test invitations and password recovery. Separately configure the Gmail claim sender, production `APP_URL`, `CRON_SECRET` and protected dispatch scheduler using [the notification guide](documentation/EMAIL_NOTIFICATIONS_SETUP.md).
7. Verify the host's request-duration, memory and file limits for AI/report operations; a route's declared timeout does not override hosting limits.
8. Test each role using appropriate demonstration accounts, including membership activation, disabled-account restrictions, claim approval and payment notifications. Keep the live website and pitch deck URLs at the top of this README current.

Do not upload production credentials into the public repository. The designated assessment demo logins are listed above; use non-sensitive demo data.

## Current boundaries

- One club and one currency; no automatic transfer, partial reimbursement or refund accounting.
- Several claim views load up to 500 recent records and then filter locally. Older records can fall outside those lists; server-side pagination remains a scalability improvement.
- Connectivity feedback and refresh are included; offline editing/submission is not guaranteed.
- Duplicate detection is limited to indexed receipts; matching details can require human interpretation.
- Member corrections and amounts exceeding the AI-read receipt total are flagged for human verification; an AI reading does not independently validate a corrected amount.
- Claim email delivery depends on configured Gmail credentials, outbound SMTP and scheduler recovery. SMTP acceptance does not prove inbox delivery, and retries cannot guarantee exactly-once delivery.
- Source code and local tests do not prove which migrations are currently applied in the remote Supabase project.
- Hosting, live Auth email, external API access and deployment URL must be configured and verified separately.

## Project documentation

The latest Word and PDF documents are in `documentation/NEW/`. Previous PDF versions are archived in `documentation/OLD/`.

The Web/App documentation follows the supplied sections: Project Overview, Features, Data Design and Technology Stack.

- [Web/App project documentation - editable Word](documentation/NEW/MoneyLai_Project_Documentation.docx)
- [Web/App project documentation - PDF](documentation/NEW/MoneyLai_Project_Documentation.pdf)
- [Technical documentation - editable Word](documentation/NEW/MoneyLai_Technicial_Documentation.docx)
- [Technical documentation - PDF](documentation/NEW/MoneyLai_Technicial_Documentation.pdf)

The technical document covers environment setup, development, usage and weekly progress. These are separate artifacts; updating this README does not regenerate their contents. Check them against the current application before submission.

Complete team/member details and verify the live website and pitch deck URLs before submission. Public documentation should use example credentials and fictional payout data only.

