"use client";
import { useState } from "react";
import Link from "next/link";
import ActivitiesOverview from "./ActivitiesOverview";
import { ClaimTrend } from "@/components/FinanceViews";
import BudgetRequests from "@/components/BudgetRequests";
import { useAuth } from "@/components/AuthProvider";
import { Loading, Notice, PageHeader } from "@/components/UI";
import { getPresidentOverview, listBudgetRequests, rpc } from "@/lib/api";
import type { MemberDirectory, MembershipApplication } from "@/lib/members/types";
import { useLoad } from "@/lib/useLoad";
import { money, STATUS_LABELS } from "@/lib/domain";
import styles from "./PresidentPage.module.css";

export default function PresidentPage() {
  const { profile } = useAuth();
  const allowed = profile?.role === "president";
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState("");
  const [status, setStatus] = useState("");
  const [budgetOpen, setBudgetOpen] = useState(true);
  const state = useLoad(
    () => (allowed ? getPresidentOverview().then(snapshot => ({ ...snapshot, loadedAt: Date.now() })) : Promise.resolve(null)),
    [allowed],
  );
  const operations = useLoad(async () => {
    if (!allowed) return null;
    const [members, applications, requests] = await Promise.allSettled([
      rpc<MemberDirectory>("ml_members"),
      rpc<MembershipApplication[]>("ml_membership_applications"),
      listBudgetRequests(),
    ]);
    return { members, applications, requests };
  }, [allowed]);
  function refresh() { state.reload(); operations.reload(); }
  if (!allowed)
    return (
      <Notice tone="error">
        President access is required. Use My claims to manage your own expenses.
      </Notice>
    );
  if (state.loading) return <Loading />;
  if (state.error)
    return (
      <Notice tone="error">
        Unable to load the overview. Please try again or contact your project
        administrator.
      </Notice>
    );
  if (!state.data) return null;
  const { activities, claims, claim_count, loadedAt } = state.data;
  const total = (
    key: "budget" | "approved_spend" | "remaining_budget" | "unpaid_amount",
  ) =>
    activities.reduce((sum, a) => sum + Math.round(Number(a[key]) * 100), 0) /
    100;
  const visible = claims.filter(
    (c) =>
      (!activity || c.activity_id === activity) &&
      (!status || c.status === status) &&
      `${c.claimant_name} ${c.activity_name} ${c.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const alerts = activities.filter(
    (a) =>
      a.status === "active" &&
      Number(a.budget) > 0 &&
      Number(a.approved_spend) / Number(a.budget) >= 0.8,
  );
  const ops = operations.data;
  const members = ops?.members.status === "fulfilled" ? ops.members.value.members : null;
  const applications = ops?.applications.status === "fulfilled" ? ops.applications.value : null;
  const requests = ops?.requests.status === "fulfilled" ? ops.requests.value : null;
  const pendingBudgets = requests?.filter(r => r.status === "pending").length;
  const pendingMembers = applications?.filter(a => a.status === "pending").length;
  const activeMembers = members?.filter(m => m.account_status === "active");
  const treasurers = activeMembers?.filter(m => m.role === "treasurer").length;
  const waiting = claims.filter(c => c.status === "submitted" && c.submitted_at && loadedAt - Date.parse(c.submitted_at) >= 7 * 86400000);
  const updates = [
    ...(requests ?? []).filter(r => r.reviewed_at).map(r => ({ id: `budget-${r.id}`, title: `${r.name} · Budget ${r.status}`, date: r.reviewed_at! })),
    ...claims.filter(c => c.submitted_at).map(c => ({ id: `claim-${c.id}`, title: `${c.activity_name} · Claim submitted`, date: c.submitted_at! })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
  const day = (value: string) => new Date(value).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" });
  const unavailable = operations.loading ? "Loading…" : "Unavailable";
  return (
    <div className={styles.page}>
      <PageHeader
        title="Club overview"
        description=""
        action={
          <button className="button secondary" onClick={refresh}>
            Refresh
          </button>
        }
      />
      <div className={styles.stats}>
        <div className={styles.stat}><span>Members</span><strong>{activeMembers?.length ?? "—"}</strong><small>{treasurers === undefined ? unavailable : `${treasurers} active treasurer${treasurers === 1 ? "" : "s"}`}</small></div>
        <div className={styles.stat}><span>Active activities</span><strong>{activities.filter(a => a.status === "active").length}</strong><small>{activities.filter(a => a.status === "closed").length} closed</small></div>
        <div className={styles.stat}><span>Allocated budget</span><strong>{money(total("budget"))}</strong><small>All activities</small></div>
        <div className={styles.stat}><span>Remaining budget</span><strong>{money(total("remaining_budget"))}</strong><small>Budget allocation, not bank balance</small></div>
      </div>
      <div className={styles.columns}>
        <section className={`panel ${styles.section}`}>
          <h2>Needs your attention</h2>
          <a className={styles.actionRow} href="#budget-requests" onClick={() => setBudgetOpen(true)}><span>Budget requests</span><strong title="Pending requests in up to 500 loaded records">{pendingBudgets ?? unavailable} <span aria-hidden="true">↗</span></strong></a>
          <Link className={styles.actionRow} href="/members"><span>Membership applications</span><strong>{pendingMembers ?? unavailable} <span aria-hidden="true">↗</span></strong></Link>
          {pendingBudgets === 0 && pendingMembers === 0 && <p className={styles.caption}>All caught up.</p>}
          {ops && [ops.members, ops.applications, ops.requests].some(r => r.status === "rejected") && <p className={styles.caption}>Some club data is unavailable. <button className="button secondary" onClick={operations.reload}>Retry</button></p>}
        </section>
        <section className={`panel ${styles.section}`}>
          <h2>Follow-up</h2>
          <div className={styles.actionRow}><span>Approved expenditure</span><strong>{money(total("approved_spend"))}</strong></div>
          <div className={styles.actionRow}><span>Awaiting payment</span><strong>{money(total("unpaid_amount"))}</strong></div>
          <div className={styles.actionRow}><span>Pending claim review</span><strong>{money(activities.reduce((n, a) => n + Math.round(Number(a.pending_amount) * 100), 0) / 100)}</strong></div>
          {alerts.length > 0 && <a className={styles.alert} href="#activity-overview">{alerts.length} activit{alerts.length === 1 ? "y has" : "ies have"} used at least 80% of budget</a>}
          {waiting.length > 0 && <p className={styles.caption}>{waiting.length} loaded claim{waiting.length === 1 ? "" : "s"} awaiting review, submitted 7+ days ago.</p>}
          <small className={styles.caption}>Treasurer handles claim review and payments.</small>
        </section>
      </div>
      <ActivitiesOverview activities={activities} />
      <details className={styles.disclosure} id="budget-requests" open={budgetOpen} onToggle={event => setBudgetOpen(event.currentTarget.open)}>
        <summary>Budget requests</summary>
        <BudgetRequests compact onChanged={refresh} />
      </details>
      <div className={styles.columns}>
        <ClaimTrend claims={claims} />
        <section className={`panel ${styles.section}`}>
          <h2>Recent updates</h2>
          {!updates.length ? <p className={styles.caption}>No updates yet.</p> : <ul className={styles.updates}>{updates.map(item => <li key={item.id}><span>{item.title}</span><time dateTime={item.date}>{day(item.date)}</time></li>)}</ul>}
          <small className={styles.caption}>Recent claim submissions and loaded budget decisions.</small>
        </section>
      </div>
      <details className={styles.disclosure}>
        <summary>View all claims <span>{claim_count}</span></summary>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Claims</h2>
          </div>
          <span>{visible.length} shown</span>
        </div>
        <details className={styles.caption}>
          <summary>About these records</summary><p>
          Up to 500 most recently submitted claims, from {claim_count} current
          non-draft claims. Filters apply to this list. Financial totals above
          cover all claims. Drafts, receipts and bank details are excluded.
        </p></details>
        <div className={styles.filters}>
          <label>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, activity or purpose"
              type="search"
            />
          </label>
          <label>
            Activity
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
            >
              <option value="">All activities</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="needs_info">Needs information</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="paid">Reimbursed</option>
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <p>No claims match these filters.</p>
        ) : (
          <div
            className={styles.tableScroll}
            role="region"
            aria-label="Club claim summaries, scroll horizontally for more columns"
            tabIndex={0}
          >
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                Club claim summaries, read-only
              </caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Activity / purpose</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id}>
                    <td>{c.claimant_name}</td>
                    <td>
                      <strong>{c.activity_name}</strong>
                      <span className={styles.description}>
                        {c.description}
                      </span>
                    </td>
                    <td className={styles.amount}>{money(c.amount)}</td>
                    <td>
                      {c.submitted_at
                        ? new Date(c.submitted_at).toLocaleDateString("en-MY", {
                            timeZone: "Asia/Kuala_Lumpur",
                          })
                        : "Not recorded"}
                    </td>
                    <td>
                      <span className={`badge ${c.status}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </details>
    </div>
  );
}
