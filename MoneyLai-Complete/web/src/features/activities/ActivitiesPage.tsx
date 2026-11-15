"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  PageHeader,
  Notice,
  Loading,
  EmptyState,
  Field,
} from "@/components/UI";
import { useLoad } from "@/lib/useLoad";
import { getActivityEvents, listActivities, rpc } from "@/lib/api";
import { amountError, errorMessage, money, dateTime } from "@/lib/domain";
import type { Activity } from "@/lib/types";
export default function ActivitiesPage() {
  const { profile } = useAuth();
  const fiscal = profile?.role === "treasurer";
  const { data, error, loading, reload } = useLoad(listActivities);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Activity | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  async function changeStatus(a: Activity) {
    const reason = prompt(
      a.status === "active"
        ? "Why are you closing this activity?"
        : "Why are you reopening this activity?",
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setActionError("Provide a reason of at least 3 characters.");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await rpc("ml_set_activity_status", {
        p_activity_id: a.id,
        p_status: a.status === "active" ? "closed" : "active",
        p_reason: reason,
      });
      setMessage("Activity status updated.");
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="PLAN IT. FUND IT. MAKE IT HAPPEN."
        title="Activities"
        description="A shared view of your club’s events and their budgets."
        action={
          fiscal ? (
            <button className="button primary" onClick={() => setEditor("new")}>
              + New activity
            </button>
          ) : undefined
        }
      />
      {message && <Notice tone="success">{message}</Notice>}
      {actionError && <Notice tone="error">{actionError}</Notice>}
      {editor && fiscal && (
        <ActivityForm
          key={editor === "new" ? "new" : editor.id}
          activity={editor === "new" ? null : editor}
          onCancel={() => setEditor(null)}
          onDone={() => {
            setEditor(null);
            setMessage("Activity saved.");
            reload();
          }}
        />
      )}
      <div className="filter-bar">
        <input
          aria-label="Search activities"
          placeholder="Search activities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter activities"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="active">Active activities</option>
          <option value="closed">Closed activities</option>
          <option value="">All activities</option>
        </select>
        <button
          className="button secondary"
          onClick={reload}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice tone="error">{error}</Notice>
      ) : (
        <div className="activity-grid">
          {(data ?? [])
            .filter(
              (a) =>
                (!filter || a.status === filter) &&
                a.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((a) => (
              <article className="panel activity-card" key={a.id}>
                <div className="section-heading">
                  <span
                    className={`badge ${a.status === "active" ? "paid" : "draft"}`}
                  >
                    {a.status === "active" ? "Active" : "Closed"}
                  </span>
                  <small>{a.event_date ?? "Date to be confirmed"}</small>
                </div>
                <h2>{a.name}</h2>
                <p className="muted">
                  {a.description || "No description added."}
                </p>
                <div className="activity-balance">
                  <small>Available budget</small>
                  <strong>{money(a.remaining_budget)}</strong>
                </div>
                <progress
                  aria-label={`${a.name} budget used`}
                  max={Math.max(Number(a.budget), 1)}
                  value={Number(a.approved_spend)}
                />
                <div className="budget-metrics">
                  <div>
                    <small>Allocated</small>
                    <strong>{money(a.budget)}</strong>
                  </div>
                  <div>
                    <small>Approved spend</small>
                    <strong>{money(a.approved_spend)}</strong>
                  </div>
                  <div>
                    <small>Pending review</small>
                    <strong>{money(a.pending_amount)}</strong>
                  </div>
                  <div>
                    <small>Awaiting payment</small>
                    <strong>{money(a.unpaid_amount)}</strong>
                  </div>
                </div>
                {Number(a.pending_amount) > Number(a.remaining_budget) && (
                  <Notice>Pending requests exceed the available budget.</Notice>
                )}
                <div className="form-actions">
                  {a.status === "active" && (
                    <Link
                      href={`/claims/new?activity=${a.id}`}
                      className="button secondary"
                    >
                      New claim →
                    </Link>
                  )}
                  {fiscal && (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setEditor(a)}
                      >
                        {a.status === "active"
                          ? "Edit & history"
                          : "View history"}
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => changeStatus(a)}
                      >
                        {a.status === "active" ? "Close" : "Reopen"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
        </div>
      )}
      {!loading &&
        !error &&
        !(data ?? []).some(
          (a) =>
            (!filter || a.status === filter) &&
            a.name.toLowerCase().includes(search.toLowerCase()),
        ) && (
          <EmptyState
            title="No activities here yet"
            description={
              fiscal
                ? "Create an activity and set its budget to get started."
                : "Your treasurer will add activities here."
            }
          />
        )}
    </>
  );
}
function ActivityForm({
  activity,
  onCancel,
  onDone,
}: {
  activity: Activity | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(activity?.name ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [budget, setBudget] = useState(String(activity?.budget ?? ""));
  const [date, setDate] = useState(activity?.event_date ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useLoad(
    () => (activity ? getActivityEvents(activity.id) : Promise.resolve([])),
    [activity?.id],
  );
  const closed = activity?.status === "closed";
  async function save(e: FormEvent) {
    e.preventDefault();
    const issue = amountError(budget, true);
    if (issue) {
      setError(issue);
      return;
    }
    if (!name.trim() || (activity && reason.trim().length < 3)) {
      setError("Enter an activity name and, for updates, a reason.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await rpc("ml_save_activity", {
        p_activity_id: activity?.id ?? null,
        p_name: name,
        p_description: description,
        p_budget: budget,
        p_event_date: date || null,
        p_reason: reason,
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel activity-editor">
      <div className="section-heading">
        <h2>{activity ? "Activity settings" : "Create an activity"}</h2>
        <button className="text-button" onClick={onCancel}>
          Close editor
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!closed && (
        <form onSubmit={save} noValidate>
          <fieldset disabled={busy}>
            <div className="form-grid">
              <Field label="Activity name" id="activity-name">
                <input
                  id="activity-name"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Budget (RM)" id="budget">
                <input
                  id="budget"
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Description" id="activity-description">
              <textarea
                id="activity-description"
                maxLength={2000}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="form-grid">
              <Field label="Event date (optional)" id="event-date">
                <input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              {activity && (
                <Field label="Update reason" id="budget-reason">
                  <input
                    id="budget-reason"
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              )}
            </div>
            <button className="button primary">
              {busy ? "Saving…" : "Save activity"}
            </button>
          </fieldset>
        </form>
      )}
      {activity && (
        <>
          <h3 className="subsection-title">Budget & status history</h3>
          {history.error && <Notice tone="error">{history.error}</Notice>}
          <ul className="compact-history">
            {history.data?.map((e) => (
              <li key={e.id}>
                <strong>{e.note}</strong>
                <span>
                  {e.old_budget === null ? "Created" : money(e.old_budget)} →{" "}
                  {money(e.new_budget)}
                </span>
                <small>{dateTime(e.created_at)}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
