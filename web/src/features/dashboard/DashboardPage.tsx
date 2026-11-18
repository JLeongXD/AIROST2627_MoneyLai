"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  PageHeader,
  StatCard,
  Notice,
  Loading,
  EmptyState,
} from "@/components/UI";
import ClaimsTable from "@/components/ClaimsTable";
import { useLoad } from "@/lib/useLoad";
import { listActivities, listClaims } from "@/lib/api";
import { money } from "@/lib/domain";
export default function DashboardPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const president = profile?.role === "president";
  useEffect(() => {
    if (president) router.replace("/president");
  }, [president, router]);
  const treasurer = profile?.role === "treasurer";
  const { data, error, loading } = useLoad(async () => {
    if (president) return { activities: [], claims: [] };
    const [activities, claims] = await Promise.all([
      listActivities(),
      listClaims(treasurer ? undefined : user!.id),
    ]);
    return { activities, claims };
  }, [user?.id, treasurer, president]);
  if (president || loading) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;
  const { claims, activities } = data;
  const total = (values: (number | string)[]) =>
    values.reduce<number>((sum, v) => sum + Math.round(Number(v) * 100), 0) /
    100;
  const pending = claims.filter((c) => c.status === "submitted");
  const unpaid = claims.filter((c) => c.status === "approved");
  const paid = claims.filter((c) => c.status === "paid");
  return (
    <>
      <PageHeader
        eyebrow="YOUR FINANCIAL SNAPSHOT"
        title={`Hello, ${profile?.display_name.split(" ")[0]}.`}
        description={
          treasurer
            ? "A clear view of your club’s budgets, reviews and reimbursements."
            : "Everything you need to keep your expenses moving."
        }
        action={
          <Link href="/claims/new" className="button primary">
            + New claim
          </Link>
        }
      />
      <div className="stats-grid">
        <StatCard
          label={
            treasurer ? "Available club budget" : "Awaiting my reimbursement"
          }
          value={money(
            treasurer
              ? total(
                  activities
                    .filter((a) => a.status === "active")
                    .map((a) => a.remaining_budget),
                )
              : total(unpaid.map((c) => c.amount)),
          )}
          note={
            treasurer
              ? "Active activities · after approvals"
              : "Approved, not yet paid"
          }
        />
        <StatCard
          label="Pending review"
          value={String(pending.length)}
          note={`${money(total(pending.map((c) => c.amount)))} awaiting a decision`}
        />
        <StatCard
          label={treasurer ? "Ready for payment" : "Reimbursed to me"}
          value={money(total((treasurer ? unpaid : paid).map((c) => c.amount)))}
          note={
            treasurer
              ? `${unpaid.length} approved claims`
              : `${paid.length} completed claims`
          }
        />
        <StatCard
          label="Active activities"
          value={String(activities.filter((a) => a.status === "active").length)}
          note="Plan, spend and stay on track"
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">AT A GLANCE</span>
              <h2>Activity budgets</h2>
            </div>
            <Link href="/activities">View all ↗</Link>
          </div>
          {activities
            .filter((a) => a.status === "active")
            .slice(0, 4)
            .map((a) => (
              <div className="budget-row" key={a.id}>
                <div>
                  <strong>{a.name}</strong>
                  <span>{money(a.remaining_budget)} left</span>
                </div>
                <progress
                  aria-label={`${a.name} approved budget usage`}
                  value={Number(a.approved_spend)}
                  max={Math.max(Number(a.budget), 1)}
                />
                <small>
                  {money(a.approved_spend)} of {money(a.budget)} approved
                </small>
              </div>
            ))}
          {!activities.some((a) => a.status === "active") && (
            <p className="muted">No active activities yet.</p>
          )}
        </section>
        <section className="panel action-panel">
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h2>
            {treasurer
              ? "Keep things moving."
              : "A receipt today. Less chasing tomorrow."}
          </h2>
          <p>
            {treasurer
              ? "Review submitted claims, then record payments once the transfer is complete."
              : "Save your expense, attach the receipt and submit it for review. You can follow every step here."}
          </p>
          <Link
            className="button secondary"
            href={treasurer ? "/treasury" : "/claims/new"}
          >
            {treasurer ? "Open treasury →" : "Start a claim →"}
          </Link>
          <Link className="text-button" href="/profile">
            Check payout details
          </Link>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>{treasurer ? "Recent club claims" : "Recent claims"}</h2>
          <Link href={treasurer ? "/treasury" : "/claims"}>View all ↗</Link>
        </div>
        {claims.length ? (
          <ClaimsTable claims={claims.slice(0, 5)} showClaimant={treasurer} />
        ) : (
          <EmptyState
            title="A fresh start"
            description="Your claims will appear here."
            href="/claims/new"
            label="Create a claim"
          />
        )}
      </section>
    </>
  );
}
