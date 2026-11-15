# MoneyLai

Complete basic club budget and reimbursement web application. English interface; Member and Treasurer roles. No AI integration is included.

## 中文快速开始

这是基于原项目完成的版本，原 ZIP 不会被修改。建议先解压到一个新目录，保留旧项目作备份。不要把旧版 `page.tsx` 覆盖到新版中。

### 1. 配置 Supabase 数据库

**已有 MoneyLai 数据库（已执行 001–005）：只执行一次 `supabase/migrations/006_complete_workflow.sql`。**

它会保留原来的活动和申请，补上角色、收据、审核、付款与历史记录，并改成通过受控 RPC 修改业务数据。旧版直接 `.insert()` / `.update()` 的页面应与新版代码一起替换。

**全新 Supabase 项目：** 执行一次 `supabase/SETUP_FRESH.sql`。不要在已有活动或申请表的项目执行这份全新安装脚本。

在 Supabase Dashboard 的 SQL Editor 执行。不是在 VS Code terminal 执行，也不是只把文件放进文件夹。006 使用一个事务；有错误时请先处理错误，不要逐句跳过。

### 2. 建立会员与财政账号

在 Supabase Authentication 中手动创建账号并确认邮箱：

- 一位普通会员。
- 一位财政；若财政也会提交自己的申请，另需第二位财政，避免自己审核自己。

新账号默认角色是 member。迁移会为原有账号补建 profile，不会自动把任何人提升为财政。

将 `supabase/BOOTSTRAP_ROLES.sql` 中的示例邮箱改成真实财政账号，再在 SQL Editor 执行。不要把真实密码写入代码。账号通过受控邀请或后台创建；在 Supabase Auth 设置关闭公开注册和匿名登录，使所有登录账号都属于这个社团。

### 3. 配置网站

在 `web` 目录创建 `.env.local`，可以复制原来的文件，或参考 `.env.example`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

只使用 publishable key，不要把 secret key、service_role key 或数据库密码放入 `NEXT_PUBLIC_` 变量。交付 ZIP 不包含原来的 `.env.local`。

### 4. 安装并运行

安装支持此项目所锁定 Next.js 版本的 Node.js LTS。保留附带的 package-lock.json。

```powershell
cd web
npm ci
npm run dev
```

打开 `http://localhost:3000`，使用 Authentication 中建立的账号登录。

发布前检查：

```powershell
npm run typecheck
npm test
npm run build
```

### 5. 完整演示流程

1. 财政登录，进入 Activities，创建活动和预算。
2. 会员登录，进入 Profile，填写真实使用前已核对的收款资料；演示使用虚构资料。
3. New claim：选择活动、金额、日期、类别、用途，保存草稿。
4. 在申请详情上传至少一份 Receipt，按 Submit for review。
5. 财政在 Treasury 的 Pending review 打开申请，核对原件后批准或填写拒绝原因。
6. 批准后，财政在系统外完成银行或电子钱包转账。
7. 在申请详情填写付款日期、编号、上传凭证，确认已转账，记录付款。
8. 会员在 My claims 查看 Reimbursed、付款记录及时间线。

被拒绝的申请可以 Start revision，修改后重新提交。Submitted 可撤回为草稿。Approved 在付款前可由非申请人财政说明原因撤销批准。Paid 只读。

## Source organisation

Next.js App Router requires `page.tsx` route entry files. They contain only a small export or wrapper. Edit the clearly named files below for actual page code:

```text
web/src/
  features/
    auth/LoginPage.tsx
    auth/UpdatePasswordPage.tsx
    dashboard/DashboardPage.tsx
    activities/ActivitiesPage.tsx
    claims/MyClaimsPage.tsx
    claims/ClaimEditorPage.tsx       # shared new/edit form
    claims/ClaimDetailPage.tsx       # files, review, payment, history
    treasury/TreasuryPage.tsx
    profile/ProfilePage.tsx
  components/
    AppShell.tsx                    # navigation + UI session gate
    AuthProvider.tsx                # browser session + profile
    ClaimsTable.tsx
    UI.tsx
  lib/
    api.ts                         # queries, RPC and private file helpers
    domain.ts                      # validation and formatting
    types.ts
    useLoad.ts
    supabase/client.ts
    supabase/server.ts              # recovery callback only
  app/                             # short Next.js route entries
supabase/
  migrations/001...006              # source of database changes
  SETUP_FRESH.sql                   # new projects only
  BOOTSTRAP_ROLES.sql               # manually replace sample emails
```

| Route | Purpose |
|---|---|
| `/` | Redirect to overview |
| `/login` | Sign in and password recovery request |
| `/dashboard` | Member or treasurer summary |
| `/activities` | Budgets; treasury-only activity management |
| `/claims` | Own claims, search, state filter, draft deletion |
| `/claims/new` | Save a draft |
| `/claims/[id]` | Attachments, submit, history, review, payment |
| `/claims/[id]/edit` | Edit own draft |
| `/treasury` | Review/payment queues and history |
| `/profile` | Display name and private payout details |
| `/update-password` | Update password after a recovery link |
| `/auth/callback` | Exchange a Supabase recovery/auth code |

## Architecture and permissions

The React interface uses Supabase Auth and authenticated Data API calls. PostgreSQL RLS enforces record access. Public application tables are read-only to the normal browser client after 006; controlled `ml_*` database RPCs perform business writes. The UI session gate improves navigation but is not the security boundary.

Each exposed mutation verifies the current identity and ownership/treasurer role inside the database. Internal helpers have no direct authenticated execution grant. SECURITY DEFINER functions use an empty search_path and schema-qualified application objects. Ordinary members cannot assign roles or mutate approved amounts, status or payment records directly.

The app uses one club. All configured users can see activity budget summaries, but cannot see other members' claim details, receipts or bank details. Treasurers can access records needed to review and reimburse claims. A treasurer's own claim must be handled by another treasurer.

### Budget calculations

- Approved expenditure = Approved + Paid claim amounts.
- Available = allocation minus approved expenditure.
- Pending review = Submitted claim amounts; these do not reserve funds.
- Awaiting payment = Approved claim amounts.
- Payment changes Approved to Paid without subtracting budget again.
- Approvals and budget adjustments lock the activity first, then the claim, and validate within the transaction.
- One payment per claim, enforced by a unique constraint. Recording a completed payment again returns the existing payment instead of duplicating it.

Amounts are MYR and use exact PostgreSQL numeric values. UI totals are only presentation; the database makes all budget decisions.

### Documents

006 creates two private Storage buckets: `receipts` and `payment-proofs`. JPG, PNG and PDF only, maximum 5 MB per file. Five receipt/supporting attachments per claim. At least one receipt is required before submission.

Documents use `user-id/claim-id/random-name.ext`. Storage policies check identity, claim state and permitted purpose. Linked receipts and recorded payment proofs cannot be removed directly. Preview access uses short-lived signed URLs; click the preview button, then the generated link. Payment proof becomes visible to the relevant claimant after the payment is recorded.

Draft deletion is allowed only before any submission history and after attachments have been removed from the claim detail page. A revised, previously submitted draft is retained for traceability. If storage cleanup fails after unlinking an attachment, the app reports it; remove the orphan object manually through Storage when confirmed unreferenced. Do not delete file metadata directly through SQL as routine cleanup.

### Password recovery

Set the Supabase Auth Site URL to the deployed origin. Add allowed redirect URLs for localhost and production, including `http://localhost:3000/auth/callback` and `https://YOUR_HOST/auth/callback`. Ensure the query form used by recovery (`?next=/update-password`) is allowed by the redirect configuration. For reliable email delivery, configure an appropriate SMTP provider and verify the actual recovery flow. The code callback and reset UI are included; real mail delivery is project configuration, not provided credentials.

## Validation

See `docs/VERIFICATION.md` for completed checks and limits. Lightweight domain tests require only installed project dependencies. Optional database tests execute the real migrations in embedded PostgreSQL, with only Supabase Auth/Storage infrastructure stubbed:

```powershell
# Optional local integration-test dependency; not a runtime requirement.
npm install --no-save --package-lock=false @electric-sql/pglite
npm run test:database
```

They do not connect to or modify a remote Supabase project. They cannot verify live Supabase Auth mail delivery, Storage HTTP uploads or production connection settings.

## Deployment

Import the repository into Vercel, set Root Directory to `web`, configure the two environment variables, and deploy using the committed lockfile. Apply the matching database migration separately in Supabase. Set Auth URLs to the actual host. No AI service or separate Python server is needed.

## Current boundaries

No AI, automatic money transfer, self-service role administration, email notifications, multiple clubs/currencies, partial reimbursements, refunds or accounting ledger. Lists show up to 500 recent claims and provide client-side search/filter; add server pagination if the real dataset grows beyond this. This delivery provides the basic workflow; it does not silently deploy or migrate your live project.
