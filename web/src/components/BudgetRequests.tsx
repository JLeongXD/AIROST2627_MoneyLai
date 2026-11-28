"use client";
import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";
import { Notice, Loading, Field } from "./UI";
import { listBudgetRequests, rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { dateTime, money, errorMessage } from "@/lib/domain";
import type { BudgetRequest } from "@/lib/types";
import styles from "./BudgetRequests.module.css";
import { useFeedback, useOperationError } from "./FeedbackProvider";

export default function BudgetRequests({
  onChanged,
  compact = false,
}: {
  onChanged: () => void;
  compact?: boolean;
}) {
  const { profile, user } = useAuth();
  const allowed =
    profile?.role === "president" || profile?.role === "treasurer";
  const state = useLoad(
    () => (allowed ? listBudgetRequests() : Promise.resolve([])),
    [profile?.role],
  );
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<BudgetRequest | null>(null);
  const [decision, setDecision] = useState("approve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useOperationError("Budget decision could not be saved");
  const notify = useFeedback();
  const [message, setMessage] = useState("");
  if (!allowed) return null;
  const requests = state.data ?? [];
  const visible = requests.filter((r) => !filter || r.status === filter);
  async function act(e: FormEvent) {
    e.preventDefault();
    if (!selected || busy) return;
    if (decision === "reject" && note.trim().length < 3) {
      setError("Provide a rejection reason of at least 3 characters.");
      return;
    }
    setBusy(true);
    notify({ title: "Saving budget decision…", tone: "progress" });
    setError("");
    setMessage("");
    try {
      if (decision === "cancel")
        await rpc("ml_cancel_budget", { p_request_id: selected.id });
      else
        await rpc("ml_decide_budget", {
          p_request_id: selected.id,
          p_approve: decision === "approve",
          p_note: note,
        });
      setSelected(null);
      notify({ title: decision === "approve" ? "Budget approved and applied" : decision === "reject" ? "Budget request rejected" : "Budget request cancelled", description: decision === "approve" ? "The activity budget is updated. Review the allocation in Activities." : "The existing activity budget is unchanged. The decision remains in request history.", href: "/activities", label: "View activities" });
      setNote("");
      setMessage(
        decision === "approve"
          ? "Budget approved and applied."
          : decision === "reject"
            ? "Request rejected. The existing budget is unchanged."
            : "Request cancelled.",
      );
      state.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(r: BudgetRequest, next: string) {
    setSelected(r);
    setDecision(next);
    setNote("");
    setError("");
    setMessage("");
  }
  return (
    <section className={`panel ${styles.section}`}>
      <div className="section-heading">
        {!compact && <div>
          <span className="eyebrow">PROPOSE. REVIEW. FUND.</span>
          <h2>Budget requests &amp; history</h2>
        </div>}
        <button
          className="button secondary"
          disabled={state.loading || busy}
          onClick={state.reload}
        >
          Refresh requests
        </button>
      </div>
      {compact ? <details className={styles.meta}><summary>Approval rules</summary><p>Changes take effect after President approval. Proposed amounts replace the total budget; they are not additional funds.</p></details> : <p>
        New activities and activity updates take effect only after President
        approval. Proposed amounts are the new total budgets, not additional
        amounts.
      </p>}
      <label className={styles.filter}>
        Request status
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
          <option value="">All requests</option>
        </select>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {selected && (
        <form onSubmit={act} className={styles.decision}>
          <h3>
            {decision === "approve"
              ? "Approve budget"
              : decision === "reject"
                ? "Reject request"
                : "Cancel request"}
            : {selected.name}
          </h3>
          <p>
            {selected.base_budget === null
              ? "New activity"
              : money(selected.base_budget)}{" "}
            → {money(selected.proposed_budget)}
          </p>
          {decision !== "cancel" && (
            <Field
              label={
                decision === "reject"
                  ? "Reason (required)"
                  : "Decision note (optional)"
              }
              id="budget-decision-note"
            >
              <textarea
                id="budget-decision-note"
                maxLength={1000}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </Field>
          )}
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              {busy ? "Saving…" : "Confirm decision"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Back
            </button>
          </div>
        </form>
      )}
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <Notice tone="error">{state.error}</Notice>
      ) : visible.length === 0 ? (
        <p>No requests match this status.</p>
      ) : (
        <div className={styles.list}>
          {visible.map((r) => (
            <article key={r.id} className={styles.card}>
              <div className={styles.heading}>
                <h3>{r.name}</h3>
                <span
                  className={`badge ${r.status === "pending" ? "submitted" : r.status === "cancelled" ? "draft" : r.status}`}
                >
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </span>
              </div>
              <p className={styles.amount}>
                {r.base_budget === null ? "New activity" : money(r.base_budget)}{" "}
                → <strong>{money(r.proposed_budget)}</strong>
              </p>
              {r.base_budget !== null && (
                <p className={styles.meta}>
                  Change:{" "}
                  {Number(r.proposed_budget) >= Number(r.base_budget)
                    ? "+"
                    : ""}
                  {money(Number(r.proposed_budget) - Number(r.base_budget))}
                </p>
              )}
              <p>{r.description || "No description provided."}</p>
              <p>
                <strong>Reason:</strong> {r.reason}
              </p>
              <p className={styles.meta}>
                Requested by {r.requester_name} · {dateTime(r.created_at)}
                {r.event_date ? ` · Event: ${r.event_date}` : ""}
              </p>
              {r.reviewed_at && (
                <p className={styles.meta}>
                  {r.status === "cancelled"
                    ? "Cancelled"
                    : `Reviewed by ${r.reviewer_name ?? "President"}`}{" "}
                  · {dateTime(r.reviewed_at)}
                  {r.review_note ? ` · ${r.review_note}` : ""}
                </p>
              )}
              {r.status === "pending" && (
                <div className="form-actions">
                  {profile?.role === "president" &&
                    r.requested_by !== user?.id && (
                      <>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => choose(r, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => choose(r, "reject")}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  {profile?.role === "president" &&
                    r.requested_by === user?.id && (
                      <p>Another President must review your request.</p>
                    )}
                  {profile?.role === "treasurer" &&
                    r.requested_by === user?.id && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => choose(r, "cancel")}
                      >
                        Cancel request
                      </button>
                    )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <p className={styles.meta}>
        Showing up to 500 requests, prioritising pending requests. Refresh to
        check the latest decisions.
      </p>
    </section>
  );
}
