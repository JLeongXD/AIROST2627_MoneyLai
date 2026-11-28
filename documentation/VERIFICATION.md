# Verification record

Date: 15 November 2026 (Asia/Kuala_Lumpur).

## Passed

- TypeScript strict type check (`tsc --noEmit`).
- Next.js 16.4.4 production build, including all named feature routes and the recovery callback.
- 9 domain tests: amount boundaries, decimals, zero budgets, upload formats and sizes, money/date formatting and state labels.
- 21 database workflow/security checks using PGlite 0.5.16 (embedded PostgreSQL). These execute migrations 001–006, real PL/pgSQL functions, constraints and RLS under authenticated/anonymous roles. Only Supabase Auth identity and Storage infrastructure are stubbed.
- Database checks cover preservation of existing data; profile backfill; no role elevation; own-record isolation; draft editing; receipt and payout requirements; private file ownership; immutable submitted receipts; no self-approval; budget reservation; payment evidence; idempotent payment retry; no double budget deduction; private payment proof; payout snapshots; overspend prevention; budget/status controls; revision history; restricted draft deletion.
- Production login page rendered in the browser. Empty sign-in shows an English validation message.
- Signed-out navigation to `/dashboard` redirects to `/login`.
- Mobile login checked at 390 px viewport; observed page width 375 px and form width 327 px, without horizontal overflow. Desktop login inspected visually.

## Limits

- No changes were applied to the user's remote Supabase project. Migration 006 and account-role bootstrap must be applied there before the new frontend can be used.
- No real account credentials were supplied for this version. Authenticated pages and file HTTP uploads have not been exercised against the live Supabase instance end to end.
- Embedded PostgreSQL checks exercise transaction rules sequentially; they do not simulate multiple simultaneous backend connections. Activity-first row locking was reviewed in the financial RPCs, but a live concurrent-load test has not been performed.
- Actual Supabase email delivery, recovery redirects, provider limits and Vercel deployment depend on project configuration and are not verified remotely.
- Responsive CSS is included throughout. Browser visual QA covered the public login screen, not every authenticated screen at every breakpoint.

## Reproduce

From `web`:

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Optional embedded database checks:

```powershell
npm install --no-save --package-lock=false @electric-sql/pglite@0.5.16
npm run test:database
```

The optional test dependency is not required to run the website.
