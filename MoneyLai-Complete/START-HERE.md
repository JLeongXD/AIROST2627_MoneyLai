# MoneyLai 启动顺序

1. **先解压到新文件夹**，保留旧项目备份。
2. 你已经有 001–005 的数据库：到 Supabase SQL Editor 执行一次 `supabase/migrations/006_complete_workflow.sql`。**不要执行 SETUP_FRESH.sql**；那是全新数据库专用。
3. 将旧项目的 `web/.env.local` 复制到新项目的 `web/`。源码包刻意不包含真实配置。
4. 在 Supabase Authentication 建立、确认会员和财政账号。修改 `supabase/BOOTSTRAP_ROLES.sql` 的示例邮箱，在 SQL Editor 执行，指定财政。
5. VS Code 打开新项目，在终端执行：

```powershell
cd web
npm ci
npm run dev
```

6. 打开 `http://localhost:3000`。财政创建活动；会员填写 Profile 收款资料，再创建申请、上传收据、提交。财政在 Treasury 审核，通过后在线下转账，再上传付款凭证、记录报销。

## 哪些文件才是真正的页面

打开 `web/src/features/`：

- `auth/LoginPage.tsx`：登录。
- `dashboard/DashboardPage.tsx`：首页概览。
- `claims/MyClaimsPage.tsx`：我的申请。
- `claims/ClaimEditorPage.tsx`：新增及编辑草稿。
- `claims/ClaimDetailPage.tsx`：收据、提交、审核及付款。
- `activities/ActivitiesPage.tsx`：活动及预算管理。
- `treasury/TreasuryPage.tsx`：财政工作台。
- `profile/ProfilePage.tsx`：个人及收款资料。

`app/**/page.tsx` 只是 Next.js 必须保留的路由入口，通常一两行，不需要在那里找主要业务代码。

## 常见情况

- 登录后出现账户资料错误：确认已经在正确的 Supabase 项目执行 006。
- 会员看不到 Treasury：正常，只有财政可见。
- 财政不能审核自己的申请：正常，需要另一位财政。
- 删除草稿被拒绝：先进入详情移除附件；曾经正式提交的记录需要保留历史。
- 修改草稿金额后预算没变：正常，批准时才占用预算。
- 点击 View file 后出现链接：再点击生成的链接打开私有文件；链接很快过期。
- 密码恢复邮件：需要在 Supabase 配置正确的 Site URL、redirect URLs 与邮件发送设置，详见 README。

只包含基本功能，没有 AI，没有自动银行转账。完整说明与测试范围见 README.md 和 docs/VERIFICATION.md。
