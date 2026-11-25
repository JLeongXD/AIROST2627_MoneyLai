"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeader, Loading, Notice, Field } from "@/components/UI";
import { useAuth } from "@/components/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { getClaim, listActivities, rpc } from "@/lib/api";
import {
  CATEGORIES,
  amountError,
  errorMessage,
  money,
  today,
} from "@/lib/domain";
import type { Activity, Claim } from "@/lib/types";
import { useFeedback, useOperationError } from "@/components/FeedbackProvider";
import { feedbackFor } from "@/lib/workflow-feedback";

export default function ClaimEditorPage({ edit = false }: { edit?: boolean }) {
  const params = useParams<{ id: string }>();
  const id = edit ? params.id : undefined;
  const { user } = useAuth();
  const { data, error, loading } = useLoad(async () => {
    const [activities, claim] = await Promise.all([
      listActivities(),
      id ? getClaim(id) : Promise.resolve(null),
    ]);
    return {
      activities,
      claim,
      initialActivity:
        new URLSearchParams(window.location.search).get("activity") ?? "",
    };
  }, [id]);
  if (loading) return <Loading />;
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return null;
  if (
    data.claim &&
    (data.claim.claimant_id !== user?.id || data.claim.status !== "draft")
  )
    return (
      <Notice tone="error">
        Only your own draft can be edited.{" "}
        <Link href={`/claims/${id}`}>Open the claim instead.</Link>
      </Notice>
    );
  return (
    <>
      <PageHeader
        eyebrow="START WITH THE DETAILS"
        title={edit ? "Edit your draft" : "New expense claim"}
        description="Save the expense first, then add receipts and submit it for review."
        action={
          <Link href="/claims" className="button secondary">
            ← My claims
          </Link>
        }
      />
      <ClaimForm
        key={id ?? "new"}
        claim={data.claim}
        activities={data.activities}
        initialActivity={data.initialActivity}
      />
    </>
  );
}
export function ClaimForm({
  claim,
  activities,
  initialActivity,
}: {
  claim: Claim | null;
  activities: Activity[];
  initialActivity: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(claim ? 2 : 1);
  const [activityId, setActivityId] = useState(
    claim?.activity_id ?? initialActivity,
  );
  const [amount, setAmount] = useState(String(claim?.amount ?? ""));
  const [description, setDescription] = useState(claim?.description ?? "");
  const [purchaseDate, setPurchaseDate] = useState(
    claim?.purchase_date ?? today(),
  );
  const [category, setCategory] = useState(claim?.category ?? "Materials");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useOperationError("Draft could not be saved");
  const notify = useFeedback();
  const selected = activities.find((a) => a.id === activityId);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (step === 1) {
      if (selected?.status !== "active") {
        setError("Choose an active activity to continue.");
        return;
      }
      setStep(2);
      notify({ title: "Activity selected", description: "Next: enter the amount, purchase date and purpose of your expense." });
      return;
    }
    const amountIssue = amountError(amount);
    if (amountIssue) {
      setError(amountIssue);
      return;
    }
    if (!activityId || !description.trim() || description.trim().length > 500) {
      setError(
        "Select an activity and enter a description of 1 to 500 characters.",
      );
      return;
    }
    if (!purchaseDate || purchaseDate > today()) {
      setError("Enter a purchase date that is not in the future.");
      return;
    }
    setBusy(true);
    notify({ title: "Saving draft…", tone: "progress" });
    try {
      const id = await rpc<string>("ml_save_claim", {
        p_claim_id: claim?.id ?? null,
        p_activity_id: activityId,
        p_amount: amount.trim(),
        p_description: description.trim(),
        p_purchase_date: purchaseDate,
        p_category: category,
      });
      notify(claim?.info_requested_at ? { title: "Draft changes saved", description: "Next: update any requested receipts and explain your changes in the clarification reply before resubmitting.", href: `/claims/${id}#clarifications`, label: "Reply to Treasurer" } : feedbackFor("saved", id));
      router.push(`/claims/${id}?flow=receipt`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <>
      <ol className="wizard-steps" aria-label="Claim submission steps">
        {[
          "Activity",
          "Expense details",
          "Receipt",
          "AI check",
          "Review & submit",
        ].map((label, i) => (
          <li
            className={step === i + 1 ? "current" : step > i + 1 ? "done" : ""}
            key={label}
            aria-current={step === i + 1 ? "step" : undefined}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="detail-grid claim-wizard">
        <section className="panel">
          <span className="eyebrow">STEP {step} OF 5</span>
          <h2>
            {step === 1
              ? "What’s the occasion?"
              : "A few details. A clearer claim."}
          </h2>
          <p className="muted">
            Complete this step, then add your supporting receipt.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={save} noValidate>
            <fieldset disabled={busy}>
              <div hidden={step !== 1}>
                <Field
                  label="Activity"
                  id="activity"
                  hint={
                    claim
                      ? "The activity is fixed after a claim is created."
                      : undefined
                  }
                >
                  <select
                    id="activity"
                    value={activityId}
                    onChange={(e) => setActivityId(e.target.value)}
                    disabled={Boolean(claim)}
                  >
                    <option value="">Choose an activity</option>
                    {activities
                      .filter(
                        (a) =>
                          a.status === "active" || a.id === claim?.activity_id,
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.status === "closed" ? " (closed)" : ""}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <div hidden={step !== 2}>
                <div className="form-grid">
                  <Field label="Amount (RM)" id="amount">
                    <input
                      id="amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      maxLength={13}
                    />
                  </Field>
                  <Field label="Purchase date" id="purchase-date">
                    <input
                      id="purchase-date"
                      type="date"
                      max={today()}
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Category" id="category">
                  <select
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Description"
                  id="description"
                  hint={`${description.length}/500 characters · tell your treasurer what the expense was for.`}
                >
                  <textarea
                    id="description"
                    rows={4}
                    maxLength={500}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Electronic components for the robotics workshop"
                  />
                </Field>
              </div>
              <div className="form-actions">
                {step === 2 && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setStep(1);
                      setError("");
                    }}
                  >
                    Back
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={selected?.status !== "active"}
                >
                  {busy
                    ? "Saving…"
                    : step === 1
                      ? "Continue to details →"
                      : "Save draft & continue →"}
                </button>
                <Link
                  href={claim ? `/claims/${claim.id}` : "/claims"}
                  className="button secondary"
                >
                  Cancel
                </Link>
              </div>
            </fieldset>
          </form>
        </section>
        <aside>
          <div className="panel guidance">
            <span className="eyebrow">BEFORE YOU SUBMIT</span>
            <h2>A clear claim is a quicker claim.</h2>
            <ol>
              <li>Choose the right activity.</li>
              <li>Enter the amount you actually paid.</li>
              <li>Save, then upload your receipt.</li>
              <li>Check your payout details in Profile.</li>
            </ol>
            {selected && (
              <div className="budget-summary">
                <span>Activity available budget</span>
                <strong>{money(selected.remaining_budget)}</strong>
                <small>
                  Pending claims do not reserve budget. Approval does.
                </small>
              </div>
            )}
            {selected && Number(amount) > Number(selected.remaining_budget) && (
              <Notice>
                This amount exceeds the current available budget. The treasurer
                will need to resolve the budget before approval.
              </Notice>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
