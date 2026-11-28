# MoneyLai

A university club budget and expense reimbursement web application built for the AIROST internship project. MoneyLai connects Member expense submission, Treasurer review and payment recording, and President financial oversight in one role-controlled workflow.

It includes optional Gemini receipt assistance, item-level claim allocation, clarification requests, duplicate-receipt warnings and downloadable activity reports. MoneyLai records reimbursements made outside the application; it does **not** transfer money or automatically approve claims.

- **Repository:** https://github.com/JLeongXD/AIROST2627_MoneyLai
- **Live website:** Not recorded in this README yet. Add the public deployed URL before submission.
- **Project documentation:** [Web/App project document](docs/MoneyLai_Project_Documentation.docx) | [Technical document](docs/MoneyLai_Technical_Documentation.docx)

## Features and roles

Google registration supports President approval: apply with Google, wait for approval, then set a MoneyLai password to activate. Active members can use Google or email/password; existing email invitations remain supported. Follow [Google registration setup](docs/GOOGLE_SIGNUP_SETUP.md) before production use. Migration 016 and Google/Supabase configuration are required.

| Role | Main capabilities |
| --- | --- |
| Member | Maintain payout details; create and edit own drafts; upload receipts; submit, withdraw and revise eligible claims; answer information requests; track reimbursement. |
| Treasurer | Propose activities and budget changes; review other members' claims in an embedded review workspace; request information; approve/reject; record external payments with proof; export activity evidence packs. |
| President | Approve/reject budget requests; inspect financial summaries and restricted non-draft claim information; download summary packs without private receipts or bank details. |

Additional features:

- Guided expense entry and private JPG, PNG or PDF receipt previews.
- Optional receipt-first drafting: Gemini extracts one receipt, then the user confirms relevant items, exclusions, adjustments and suggested fields.
- Claim-versus-receipt AI checks with consent, outdated-result detection and manual review fallback.
- Potential duplicate detection using indexed file fingerprints and receipt details. A warning is not a finding of fraud.
- Clarification requests and replies, with claim and activity audit histories.
- Gmail notifications for approved claims and recorded payments, with a durable retry queue. Follow [email notification setup](docs/EMAIL_NOTIFICATIONS_SETUP.md); migration 017, sender credentials and a hosting scheduler are required.
- Excel, PDF and ZIP activity exports with role-specific evidence access.
- Five-second polling, focus and connectivity-triggered refresh, operation feedback and sync status. This is not a WebSocket subscription or an offline-write queue.
- Desktop top navigation and mobile bottom navigation.

## Technology stack

| Layer | Technology |
| --- | --- |
| Application | Next.js 16.4.4 App Router, React 19.3.0, TypeScript |
| Styling | CSS and CSS Modules |
| Identity and persistence | Supabase Auth, PostgreSQL, RLS and controlled PL/pgSQL RPCs |
| Documents | Supabase private Storage buckets and signed URLs |
| Optional AI | Google Gemini, called by server Route Handlers |
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

### 3. Create accounts and assign roles

Create and confirm accounts through Supabase Authentication. New application profiles default to `member`.

Edit the example emails in [BOOTSTRAP_ROLES.sql](supabase/BOOTSTRAP_ROLES.sql), then run the script as the project owner to assign Treasurer and President roles. Use a second Treasurer if a Treasurer needs to submit personal claims: a person cannot approve their own claim.

The application assumes one club with President-controlled membership. Google self-registration requires allowing new Auth signups; these identities have no business access until approved and activated. Follow [the Google setup guide](docs/GOOGLE_SIGNUP_SETUP.md). Do not commit account passwords or real payout information as demo data.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged key for protected AI, receipt and export operations |

Never prefix server credentials with `NEXT_PUBLIC_`, commit `.env.local`, or expose a service-role key to the browser. AI suggestions remain optional; manual claim entry and human review remain available when AI is unavailable. Export and receipt-assistance server routes require their corresponding database and server configuration.

### 5. Start the application

```powershell
npm run dev
```

Open http://localhost:3000 and sign in with a configured account.

## End-to-end demonstration

1. Treasurer proposes an activity and its budget; President reviews the request.
2. Member enters payout details in Profile, using fictional details for demonstrations.
3. Member selects an activity and enters an expense manually, or uses receipt assistance and confirms its item selection/calculation.
4. Member saves the draft, checks attached originals and uploads any required receipt/supporting documents.
5. Member optionally runs AI checking with consent, reviews warnings and submits for human review.
6. Treasurer inspects the original documents and allocation. They approve, reject or request more information; Member can reply to an information request.
7. After approval, Treasurer makes the bank/e-wallet transfer **outside MoneyLai**.
8. Treasurer records its date, reference and payment proof, confirming that the external transfer is complete.
9. Member checks reimbursement status and history. President reviews the restricted overview; permitted roles export the activity pack.

Eligible submitted claims can be withdrawn; rejected claims can be revised. Draft deletion and reversal of approval are subject to ownership, history and workflow rules. Previously submitted records are retained where required for traceability.

## Financial rules and security

- Currency is MYR. PostgreSQL numeric values and server-side validation govern financial decisions.
- Committed expenditure = Approved + Paid claim amounts.
- Available budget = activity allocation minus committed expenditure.
- Submitted claims do not reserve budget. Recording payment moves Approved to Paid without deducting the budget twice.
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
| `/login` | Sign-in and password recovery request |
| `/membership` | Google membership application, approval status and password activation |
| `/dashboard` | Member/Treasurer overview |
| `/activities` | Activity budgets, proposals and exports |
| `/claims` | Own claim list, search and filters |
| `/claims/new` | Manual or receipt-assisted draft entry |
| `/claims/[id]` | Evidence, AI checks, clarifications, decisions, payment and history |
| `/claims/[id]/edit` | Edit an eligible own draft |
| `/treasury` | Review/payment queues and embedded claim workspace |
| `/president` | Restricted oversight and budget decisions |
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
npm run build
```

| Command | Coverage |
| --- | --- |
| `npm test` | Domain validation and live-sync behavior |
| `npm run test:ai` | Claim comparison and mocked Gemini responses/failures |
| `npm run test:database` | Workflow/security migrations and setup checks |
| `npm run test:exports` | Report generation, export permissions and route behavior |
| `npm run test:receipts` | Receipt assistance, allocation, database and route behavior |

Database suites use local embedded PostgreSQL with test infrastructure; they are not live Supabase acceptance tests. AI tests do not establish that a real Gemini account has sufficient quota or that production receipt extraction succeeds.

These commands are reproducible checks, **not a claim that they currently all pass**. [docs/VERIFICATION.md](docs/VERIFICATION.md) is an older, dated verification record; it does not verify every newer feature. Before release, rerun checks and test actual login, role restrictions, uploads, recovery email, AI, exports and reimbursement against the configured environment.

## Deployment

Suggested configuration for a Next.js-compatible host such as Vercel:

1. Import the GitHub repository and set the project root to `web`.
2. Configure the environment variables listed above in the hosting dashboard.
3. Apply only the missing Supabase migrations for the same application version.
4. Build with `npm run build` and deploy. If the host requires a start command, use `npm run start`.
5. Set Supabase Auth Site URL to the deployed origin and allow the production `/auth/callback` redirect, including the recovery query form `?next=/update-password`. Keep localhost redirects for local development if needed.
6. Configure email delivery and test the actual password recovery flow.
7. Verify the host's request-duration, memory and file limits for AI/report operations; a route's declared timeout does not override hosting limits.
8. Test each role using appropriate demonstration accounts, then add the deployed URL to the top of this README.

Do not upload credentials into the public repository. Provide any demonstration login instructions through the appropriate assessment channel, using non-sensitive demo data.

## Current boundaries

- One club and one currency; no automatic transfer, partial reimbursement or refund accounting.
- Several claim views load up to 500 recent records and then filter locally. Older records can fall outside those lists; server-side pagination remains a scalability improvement.
- Connectivity feedback and refresh are included; offline editing/submission is not guaranteed.
- Duplicate detection is limited to indexed receipts; matching details can require human interpretation.
- Source code and local tests do not prove which migrations are currently applied in the remote Supabase project.
- Hosting, live Auth email, external API access and deployment URL must be configured and verified separately.

## Project documentation

The Web/App documentation follows the supplied sections: Project Overview, Features, Data Design and Technology Stack.

- [Web/App project documentation - editable Word](docs/MoneyLai_Project_Documentation.docx)
- [Technical documentation - editable Word](docs/MoneyLai_Technical_Documentation.docx)
The technical document covers environment setup, development, usage and weekly progress. Export the final Word documents to PDF if required by the submission form.

Complete team/member details and the live website URL before submission. Public documentation should use example credentials and fictional payout data only.

