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
import { WorkspaceHero, BudgetExplorer } from "@/components/Creative";
import { ClaimFeed, ClaimOverview } from "@/components/FinanceViews";
import { useLoad } from "@/lib/useLoad";
import { listActivities, listClaims } from "@/lib/api";
import { money } from "@/lib/domain";
export default function DashboardPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const president = profile?.role === "president",
    fiscal = profile?.role === "treasurer";
  useEffect(() => {
    if (president) router.replace("/president");
  }, [president, router]);
  const state = useLoad(async () => {
    if (president) return { activities: [], claims: [] };
    const [activities, claims] = await Promise.all([
      listActivities(),
      listClaims(fiscal ? undefined : user!.id),
    ]);
    return { activities, claims };
  }, [user?.id, fiscal, president]);
  if (president || state.loading) return <Loading />;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return null;
  const { activities, claims } = state.data,
    pending = claims.filter((c) => c.status === "submitted"),
    approved = claims.filter((c) => c.status === "approved"),
    paid = claims.filter((c) => c.status === "paid");
  const sum = (arr: { amount: number | string }[]) =>
    arr.reduce((n, c) => n + Math.round(Number(c.amount) * 100), 0) / 100;
  return (
    <>
      <PageHeader
        eyebrow={fiscal ? "FINANCE CONTROL CENTER" : "YOUR PERSONAL WORKSPACE"}
        title={
          fiscal
            ? "A clear view. A lighter workload."
            : `Welcome back, ${profile?.display_name.split(" ")[0]}.`
        }
        description={
          fiscal
            ? "Review the evidence. Keep reimbursements moving."
            : "Your expenses, your progress. All in a good place."
        }
        action={
          <Link
            className="button primary"
            href={fiscal ? "/treasury" : "/claims/new"}
          >
            {fiscal ? "Open review desk" : "+ Submit a claim"}
          </Link>
        }
      />
      <WorkspaceHero
        name={profile?.display_name.split(" ")[0] ?? "friend"}
        treasurer={fiscal}
        count={pending.filter((c) => c.claimant_id !== user?.id).length}
        amount={sum(approved)}
      />
      <div className="stats-grid">
        <StatCard
          label={fiscal ? "Loaded club claims" : "My claims"}
          value={String(claims.length)}
          note="Up to 500 recent records"
        />
        <StatCard
          label="Pending review"
          value={String(pending.length)}
          note={`${money(sum(pending))} awaiting review`}
        />
        <StatCard
          label="Awaiting payment"
          value={money(sum(approved))}
          note={`${approved.length} approved claims`}
        />
        <StatCard
          label="Reimbursed"
          value={money(sum(paid))}
          note={`${paid.length} completed claims`}
        />
      </div>
      <div className="bento-grid">
        <BudgetExplorer
          activities={activities.filter((a) => a.status === "active")}
        />
        <section className="panel editorial-note">
          <span className="eyebrow">A CLEAR CLAIM GOES FURTHER</span>
          <span className="editorial-star" aria-hidden="true">
            ✳
          </span>
          <h2>
            Every receipt.
            <br />
            <em>One less worry.</em>
          </h2>
          <p>
            Attach your receipt, check the details with AI, then send it for a
            human review.
          </p>
          <Link
            className="button secondary"
            href={fiscal ? "/treasury" : "/claims/new"}
          >
            {fiscal ? "Review a claim" : "Start a claim"} ↗
          </Link>
          <Link className="text-button" href="/profile">
            Check payout details
          </Link>
        </section>
      </div>
      <div className="bento-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE LATEST CHAPTER</span>
              <h2>{fiscal ? "Recent club claims" : "Your recent claims"}</h2>
            </div>
            <Link href={fiscal ? "/treasury" : "/claims"}>View all ↗</Link>
          </div>
          {claims.length ? (
            <ClaimFeed claims={claims.slice(0, 5)} />
          ) : (
            <EmptyState
              title="Your first chapter starts here"
              description="Save an expense and add its receipt."
              href="/claims/new"
              label="Create a claim"
            />
          )}
        </section>
        <ClaimOverview claims={claims} />
      </div>
    </>
  );
}
