"use client";
import { useState } from "react";
import { BudgetExplorer } from "@/components/Creative";
import { ExecutiveSummary, ClaimTrend } from "@/components/FinanceViews";
import BudgetRequests from "@/components/BudgetRequests";
import { useAuth } from "@/components/AuthProvider";
import { Loading, Notice, PageHeader, StatCard } from "@/components/UI";
import { getPresidentOverview } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { money, STATUS_LABELS } from "@/lib/domain";
import styles from "./PresidentPage.module.css";

export default function PresidentPage() {
  const { profile } = useAuth();
  const allowed = profile?.role === "president";
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState("");
  const [status, setStatus] = useState("");
  const state = useLoad(
    () => (allowed ? getPresidentOverview() : Promise.resolve(null)),
    [allowed],
  );
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
  const { activities, claims, claim_count } = state.data;
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
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="THE BIG PICTURE"
        title="Every decision starts with clarity."
        description="A clear view of club budgets, expenses and reimbursement progress."
        action={
          <button className="button secondary" onClick={state.reload}>
            Refresh overview
          </button>
        }
      />
      <Notice>
        Approve activity budgets here. Treasurer handles claim review and
        payments. Allocated budgets do not represent your club’s bank balance.
      </Notice>
      <ExecutiveSummary activities={activities} />
      <BudgetExplorer activities={activities} />
      <BudgetRequests onChanged={state.reload} />
      <div className="executive-strip">
        <div>
          <small>Approved expenditure</small>
          <strong>{money(total("approved_spend"))}</strong>
        </div>
        <div>
          <small>Awaiting payment</small>
          <strong>{money(total("unpaid_amount"))}</strong>
        </div>
        <div>
          <small>Pending review value</small>
          <strong>
            {money(
              activities.reduce(
                (n, a) => n + Math.round(Number(a.pending_amount) * 100),
                0,
              ) / 100,
            )}
          </strong>
        </div>
      </div>
      {alerts.length > 0 && (
        <Notice>
          Budget watch: {alerts.map((a) => a.name).join(", ")} — at least 80% of
          the allocated budget is committed.
        </Notice>
      )}
      <ClaimTrend claims={claims} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">SPENDING TRANSPARENCY</span>
            <h2>Claims overview</h2>
          </div>
          <span>{visible.length} shown</span>
        </div>
        <p className={styles.caption}>
          Up to 500 most recently submitted claims, from {claim_count} current
          non-draft claims. Filters apply to this list. Financial totals above
          cover all claims. Drafts, receipts and bank details are excluded.
        </p>
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
    </div>
  );
}
