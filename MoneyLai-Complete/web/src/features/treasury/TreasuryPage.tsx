"use client";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  PageHeader,
  Notice,
  Loading,
  EmptyState,
  StatCard,
} from "@/components/UI";
import ClaimsTable from "@/components/ClaimsTable";
import { listClaims } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { money } from "@/lib/domain";
export default function TreasuryPage() {
  const { profile, user } = useAuth();
  const [tab, setTab] = useState("submitted");
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState("");
  const state = useLoad(
    () => (profile?.role === "treasurer" ? listClaims() : Promise.resolve([])),
    [profile?.role],
  );
  if (profile?.role !== "treasurer")
    return (
      <Notice tone="error">
        Treasurer access is required. Your member claims are available under My
        claims.
      </Notice>
    );
  const claims = state.data ?? [];
  const eligible = claims.filter((c) => c.claimant_id !== user?.id);
  const pending = eligible.filter((c) => c.status === "submitted");
  const unpaid = eligible.filter((c) => c.status === "approved");
  const filtered = claims.filter(
    (c) =>
      (tab === "history"
        ? ["paid", "rejected"].includes(c.status)
        : c.status === tab) &&
      (!activity || c.activity_id === activity) &&
      `${c.description} ${c.claimant?.display_name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const activities = Array.from(
    new Map(
      claims.map((c) => [
        c.activity_id,
        c.activity?.name ?? "Activity unavailable",
      ]),
    ).entries(),
  );
  return (
    <>
      <PageHeader
        eyebrow="KEEP REIMBURSEMENTS MOVING"
        title="Treasury"
        description="Review the evidence, make a decision and record completed transfers."
      />
      <div className="stats-grid three">
        <StatCard
          label="Ready for your review"
          value={String(pending.length)}
          note="Excludes your own claims"
        />
        <StatCard
          label="Ready for your payment"
          value={money(
            unpaid.reduce((n, c) => n + Math.round(Number(c.amount) * 100), 0) /
              100,
          )}
          note={`${unpaid.length} approved claims · excludes your own`}
        />
        <StatCard
          label="Recorded reimbursements"
          value={String(claims.filter((c) => c.status === "paid").length)}
          note="Completed club claims"
        />
      </div>
      <section className="panel">
        <div className="tabs" role="group" aria-label="Treasury queue">
          {[
            { key: "submitted", label: "Pending review" },
            { key: "approved", label: "Awaiting payment" },
            { key: "history", label: "History" },
          ].map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? "selected" : ""}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="filter-bar">
          <input
            aria-label="Search claim or member"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses or members…"
          />
          <select
            aria-label="Filter by activity"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          >
            <option value="">All activities</option>
            {activities.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            onClick={state.reload}
            disabled={state.loading}
          >
            Refresh
          </button>
        </div>
        {state.loading ? (
          <Loading />
        ) : state.error ? (
          <Notice tone="error">{state.error}</Notice>
        ) : filtered.length ? (
          <ClaimsTable claims={filtered} showClaimant />
        ) : (
          <EmptyState
            title="All clear here"
            description="There are no matching claims in this queue."
          />
        )}
        <p className="table-note">
          Open a claim to inspect its documents and take action. Your own claims
          require another treasurer. Up to 500 recent records.
        </p>
      </section>
    </>
  );
}
