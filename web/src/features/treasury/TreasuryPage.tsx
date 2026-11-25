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
import { ClaimDetailWorkspace } from "@/features/claims/ClaimDetailPage";
import { listClaims } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { money, STATUS_LABELS } from "@/lib/domain";
export default function TreasuryPage() {
  const { profile, user } = useAuth();
  const [tab, setTab] = useState("submitted");
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState("");
  const [selected, setSelected] = useState("");
  const state = useLoad(
    () => (profile?.role === "treasurer" ? listClaims() : Promise.resolve([])),
    [profile?.role],
  );
  if (profile?.role !== "treasurer")
    return (
      <Notice tone="error">
        Treasurer access is required. Use My claims for your personal expenses.
      </Notice>
    );
  const claims = state.data ?? [],
    eligible = claims.filter((c) => c.claimant_id !== user?.id),
    pending = eligible.filter((c) => c.status === "submitted"),
    unpaid = eligible.filter((c) => c.status === "approved");
  const filtered = claims.filter(
    (c) =>
      (tab === "history"
        ? ["paid", "rejected"].includes(c.status)
        : tab === "needs_info" ? Boolean(c.info_requested_at) : c.status === tab) &&
      (!activity || c.activity_id === activity) &&
      `${c.description} ${c.claimant?.display_name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const current = filtered.find((c) => c.id === selected) ?? filtered[0];
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
        eyebrow="FINANCIAL OPERATIONS"
        title="The review desk."
        description="The evidence and the decision. Finally, in the same place."
      />
      <div className="stats-grid three">
        <StatCard
          label="Ready for your review"
          value={String(pending.length)}
          note="Excludes your own claims"
        />
        <StatCard
          label="Awaiting your payment"
          value={money(
            unpaid.reduce((n, c) => n + Math.round(Number(c.amount) * 100), 0) /
              100,
          )}
          note={`${unpaid.length} approved claims · excludes your own`}
        />
        <StatCard
          label="Recorded reimbursements"
          value={String(claims.filter((c) => c.status === "paid").length)}
          note="From up to 500 recent club claims"
        />
      </div>
      <section className="panel treasury-toolbar">
        <div className="tabs" role="group" aria-label="Treasury queue">
          {[
            { key: "submitted", label: "Review inbox" },
            { key: "needs_info", label: "Waiting for information" },
            { key: "approved", label: "Payments" },
            { key: "history", label: "History" },
          ].map((t) => (
            <button
              key={t.key}
              aria-pressed={tab === t.key}
              className={tab === t.key ? "selected" : ""}
              onClick={() => {
                setTab(t.key);
                setSelected("");
              }}
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
            placeholder="Search a member or expense…"
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
      </section>
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <Notice tone="error">{state.error}</Notice>
      ) : !filtered.length ? (
        <EmptyState
          title="A little breathing room."
          description="No matching claims in this queue."
        />
      ) : tab === "history" ? (
        <section className="panel">
          <ClaimsTable claims={filtered} showClaimant />
        </section>
      ) : (
        <div className="review-inbox">
          <aside className="inbox-queue">
            <div className="inbox-caption">
              {filtered.length} CLAIMS ·{" "}
              {tab === "approved" ? "PAYMENT QUEUE" : "REVIEW QUEUE"}
            </div>
            <div role="group" aria-label="Select a claim">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  className={`inbox-item ${current?.id === c.id ? "selected" : ""}`}
                  aria-pressed={current?.id === c.id}
                  onClick={() => setSelected(c.id)}
                >
                  <span className={`badge ${c.status}`}>
                    {STATUS_LABELS[c.info_requested_at ? "needs_info" : c.status]}
                  </span>
                  <strong>{c.claimant?.display_name ?? "Member"}</strong>
                  <span>{c.activity?.name}</span>
                  <p>{c.description}</p>
                  <b>{money(c.amount)}</b>
                  {c.claimant_id === user?.id && (
                    <small>Requires another Treasurer</small>
                  )}
                </button>
              ))}
            </div>
          </aside>
          <div className="inbox-detail">
            {current && (
              <ClaimDetailWorkspace
                key={current.id}
                claimId={current.id}
                onChanged={state.reload}
              />
            )}
          </div>
        </div>
      )}
      <p className="table-note">
        Review original documents before deciding. Payments are recorded after
        an external bank or e-wallet transfer.
      </p>
    </>
  );
}
