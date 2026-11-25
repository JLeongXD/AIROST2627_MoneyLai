"use client";
import Link from "next/link";
import { Journey } from "@/components/Creative";
import ReceiptPreview from "@/components/ReceiptPreview";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  PageHeader,
  Notice,
  Loading,
  StatusBadge,
  Field,
  FileLink,
  NextStep,
} from "@/components/UI";
import { useLoad } from "@/lib/useLoad";
import {
  getClaim,
  getAttachments,
  getEvents,
  getPayment,
  getPayout,
  listActivities,
  rpc,
  uploadAttachment,
  removeAttachment,
  uploadFile,
} from "@/lib/api";
import { claimCode, money, dateTime, errorMessage, fileError, today } from "@/lib/domain";
import type { Claim, Payout } from "@/lib/types";
import AIClaimCheck from "@/components/AIClaimCheck";
import ClaimClarifications from "@/components/ClaimClarifications";
import DuplicateReceipts from "@/components/DuplicateReceipts";
import { useFeedback, useOperationError } from "@/components/FeedbackProvider";
import { claimNextStep, feedbackFor, type ActionKind } from "@/lib/workflow-feedback";

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ClaimDetailWorkspace key={id} claimId={id} />;
}
export function ClaimDetailWorkspace({
  claimId: id,
  onChanged,
}: {
  claimId: string;
  onChanged?: () => void;
}) {
  const [flowStep, setFlowStep] = useState(0);
  const embedded = Boolean(onChanged);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const flow = new URLSearchParams(window.location.search).get("flow");
      setFlowStep(embedded ? 0 : flow === "receipt" ? 3 : flow === "review" ? 5 : 0);
    });
    return () => { active = false; };
  }, [id, embedded]);
  const { user, profile } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const notify = useFeedback();
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [error, setError] = useOperationError();
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<"receipt" | "supporting">("receipt");
  const [fileVersion, setFileVersion] = useState(0);
  const state = useLoad(async () => {
    const claim = await getClaim(id);
    const [attachments, events, payment, payout, activities] =
      await Promise.all([
        getAttachments(id),
        getEvents(id),
        getPayment(id),
        getPayout(claim.claimant_id),
        listActivities(),
      ]);
    return {
      claim,
      attachments,
      events,
      payment,
      payout,
      activity: activities.find((a) => a.id === claim.activity_id),
    };
  }, [id]);
  async function action(job: () => Promise<unknown>, success: string, kind: ActionKind = "updated") {
    if (busy) return;
    setBusy(true);
    setPendingAction(kind);
    notify({ title: feedbackFor(kind, id).pending, tone: "progress" });
    setError("");
    setMessage("");
    try {
      await job();
      setMessage(success);
      notify(feedbackFor(kind, id));
      setReason("");
      state.reload();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return null;
  const { claim, attachments, events, payment, payout, activity } = state.data;
  const owner = claim.claimant_id === user?.id;
  const fiscal = profile?.role === "treasurer";
  const canReview = fiscal && !owner;
  const flow = owner && claim.status === "draft" && flowStep > 0;
  const next = claimNextStep(claim.status, owner, attachments.some((a) => a.kind === "receipt"), Boolean(payout), Boolean(claim.info_requested_at));
  return (
    <div className={flow ? `claim-flow flow-${flowStep}` : "claim-document"} aria-busy={busy}>
      <NextStep {...next} onAction={owner && claim.status === "draft" && !claim.info_requested_at && next.href.startsWith("#") ? () => {
        setFlowStep(next.href === "#claim-review" ? 5 : 3);
        requestAnimationFrame(() => document.getElementById(next.href.slice(1))?.scrollIntoView({ block: "start" }));
      } : undefined} />
      {flow && (
        <>
          <ol className="wizard-steps" aria-label="Claim submission steps">
            {[
              "Activity",
              "Expense details",
              "Receipt",
              "AI check",
              "Review & submit",
            ].map((s, i) => (
              <li
                className={
                  flowStep === i + 1
                    ? "current"
                    : flowStep > i + 1
                      ? "done"
                      : ""
                }
                aria-current={flowStep === i + 1 ? "step" : undefined}
                key={s}
              >
                <span>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <div className="flow-controls">
            <p>
              {flowStep === 3
                ? "Upload at least one receipt. Your draft is saved."
                : flowStep === 4
                  ? "Check the receipt with AI, or continue with manual review."
                  : "Review the details below, then Submit for review."}
            </p>
            <div className="form-actions">
              {flowStep > 3 ? (
                <button
                  className="button secondary"
                  onClick={() => setFlowStep((s) => s - 1)}
                >
                  Back
                </button>
              ) : (
                <Link className="button secondary" href={`/claims/${id}/edit`}>
                  Edit expense
                </Link>
              )}
              {flowStep < 5 && (
                <button
                  className="button primary"
                  disabled={
                    flowStep === 3 &&
                    !attachments.some((a) => a.kind === "receipt")
                  }
                  onClick={() => setFlowStep((s) => s + 1)}
                >
                  {flowStep === 4
                    ? "Continue to review →"
                    : "Continue to AI check →"}
                </button>
              )}
              <button className="text-button" onClick={() => setFlowStep(0)}>
                View full claim
              </button>
            </div>
          </div>
        </>
      )}
      <PageHeader
        eyebrow={`CLAIM ${claimCode(claim)}`}
        title={claim.activity?.name ?? "Expense claim"}
        description={`Submitted by ${claim.claimant?.display_name ?? "Member"}`}
        action={
          <Link
            className="button secondary"
            href={fiscal && !owner ? "/treasury" : "/claims"}
          >
            ← Back to claims
          </Link>
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      <ClaimClarifications claim={claim} owner={owner} onChanged={() => { state.reload(); onChanged?.(); }} />
      {canReview && <DuplicateReceipts claimId={id} />}
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">EVERY STEP ACCOUNTED FOR</span>
            <h2>Your claim journey</h2>
          </div>
          <StatusBadge status={claim.status} />
        </div>
        <Journey status={claim.status} />
      </section>
      <div className="ai-split">
        <ReceiptPreview attachments={attachments} />
        <AIClaimCheck
          claim={claim}
          attachments={attachments}
          onChanged={state.reload}
        />
      </div>
      <div className="detail-grid">
        <div>
          <section className="panel" id="claim-review">
            <div className="section-heading">
              <h2>Expense details</h2>
              <StatusBadge status={claim.status} />
            </div>
            <div className="claim-amount">{money(claim.amount)}</div>
            <p className="claim-description">{claim.description}</p>
            <dl className="details-list">
              <div>
                <dt>Category</dt>
                <dd>{claim.category}</dd>
              </div>
              <div>
                <dt>Purchase date</dt>
                <dd>{claim.purchase_date ?? "Not added"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{dateTime(claim.created_at)}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{dateTime(claim.submitted_at)}</dd>
              </div>
            </dl>
            {claim.rejection_reason && (
              <Notice tone="error">
                <strong>Rejection reason: </strong>
                {claim.rejection_reason}
              </Notice>
            )}
            {owner && claim.status === "draft" && (
              <div className="form-actions">
                <Link href={`/claims/${id}/edit`} className="button secondary">
                  Edit details
                </Link>
                {!claim.info_requested_at && <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    action(
                      () => rpc("ml_submit_claim", { p_claim_id: id }),
                      "Claim submitted for review.",
                      "submitted",
                    )
                  }
                >
                  {pendingAction === "submitted" ? "Submitting…" : "Submit for review →"}
                </button>}
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this draft permanently? Remove attachments first.",
                      )
                    )
                      void action(async () => {
                        await rpc("ml_delete_claim", { p_claim_id: id });
                        router.replace("/claims");
                      }, "Draft deleted.", "deleted");
                  }}
                >
                  Delete draft
                </button>
              </div>
            )}
            {owner && claim.status === "submitted" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  if (confirm("Withdraw this claim so you can edit it?"))
                    void action(
                      () => rpc("ml_return_to_draft", { p_claim_id: id }),
                      "Claim returned to draft.",
                      "withdrawn",
                    );
                }}
              >
                Withdraw to draft
              </button>
            )}
            {owner && claim.status === "rejected" && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  action(
                    () => rpc("ml_return_to_draft", { p_claim_id: id }),
                    "You can now revise and resubmit this claim.",
                    "revised",
                  )
                }
              >
                Start revision
              </button>
            )}
            {owner && claim.status === "draft" && !payout && (
              <Notice>
                Add your <Link href="/profile">payout details</Link> before
                submitting.
              </Notice>
            )}
          </section>
          <section className="panel" id="supporting-documents">
            <div className="section-heading">
              <h2>Supporting documents</h2>
              <span className="muted">{attachments.length}/5 files</span>
            </div>
            <p className="muted">
              At least one receipt is required. JPG, PNG or PDF, up to 5 MB
              each.
            </p>
            {attachments.length ? (
              <ul className="attachment-list">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <span className="file-icon">
                      {a.mime_type === "application/pdf" ? "PDF" : "IMG"}
                    </span>
                    <div>
                      <strong>{a.original_name}</strong>
                      <small>
                        {a.kind === "receipt"
                          ? "Receipt"
                          : "Supporting document"}{" "}
                        · {(a.size_bytes / 1024).toFixed(0)} KB
                      </small>
                      <FileLink
                        bucket="receipts"
                        path={a.storage_path}
                        label="View file"
                      />
                    </div>
                    {owner && claim.status === "draft" && (
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        onClick={() =>
                          action(
                            () => removeAttachment(a.id),
                            "Attachment removed.",
                            "removed",
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No files attached yet.</p>
            )}
            {owner && claim.status === "draft" && attachments.length < 5 && (
              <form
                className="upload-box"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add("drag-over");
                }}
                onDragLeave={(e) =>
                  e.currentTarget.classList.remove("drag-over")
                }
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("drag-over");
                  if (busy) return;
                  const dropped = e.dataTransfer.files[0];
                  if (!dropped) return;
                  const issue = fileError(dropped);
                  if (issue) {
                    setError(issue);
                    return;
                  }
                  setFile(dropped);
                  setError("");
                }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!file) {
                    setError("Choose a file first.");
                    return;
                  }
                  void action(async () => {
                    await uploadAttachment(id, file, fileKind);
                    setFile(null);
                    setFileVersion((n) => n + 1);
                  }, "File uploaded.", "uploaded");
                }}
              >
                <p className="drop-hint">
                  Drop a receipt here, or choose a file below.{" "}
                  {file ? `Selected: ${file.name}` : ""}
                </p>
                <fieldset disabled={busy}>
                  <Field label="Document type" id="file-kind">
                    <select
                      id="file-kind"
                      value={fileKind}
                      onChange={(e) =>
                        setFileKind(e.target.value as "receipt" | "supporting")
                      }
                    >
                      <option value="receipt">Receipt</option>
                      <option value="supporting">Supporting document</option>
                    </select>
                  </Field>
                  <Field label="Choose file" id="receipt-file">
                    <input
                      key={fileVersion}
                      id="receipt-file"
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(e) => {
                        const chosen = e.target.files?.[0] ?? null;
                        const issue = chosen ? fileError(chosen) : null;
                        setError(issue ?? "");
                        setFile(issue ? null : chosen);
                      }}
                    />
                  </Field>
                  <button className="button secondary" disabled={!file}>
                    {busy ? "Uploading…" : "Upload file"}
                  </button>
                </fieldset>
              </form>
            )}
          </section>
          <section className="panel">
            <h2>Claim timeline</h2>
            <ol className="timeline">
              {events.map((e) => (
                <li key={e.id}>
                  <strong>{e.event_type.replaceAll("_", " ")}</strong>
                  <p>{e.note}</p>
                  <small>
                    {e.actor?.display_name ??
                      String(e.snapshot.actor_name ?? "Club officer")}{" "}
                    · {dateTime(e.created_at)}
                  </small>
                  {e.snapshot.amount !== undefined && (
                    <small>
                      Recorded amount: {money(String(e.snapshot.amount))}
                    </small>
                  )}
                </li>
              ))}
              <li>
                <strong>Draft created</strong>
                <small>{dateTime(claim.created_at)}</small>
              </li>
            </ol>
          </section>
        </div>
        <aside>
          {activity && (
            <section className="panel">
              <span className="eyebrow">ACTIVITY BUDGET</span>
              <h2>{money(activity.remaining_budget)}</h2>
              <p className="muted">Available from {money(activity.budget)}</p>
              <progress
                aria-label="Approved budget usage"
                max={Math.max(Number(activity.budget), 1)}
                value={Number(activity.approved_spend)}
              />
              <p className="small-text">
                Pending claims: {money(activity.pending_amount)}
                <br />
                If all pending claims pass:{" "}
                {money(
                  Number(activity.remaining_budget) -
                    Number(activity.pending_amount),
                )}
              </p>
            </section>
          )}
          {fiscal &&
            owner &&
            ["submitted", "approved"].includes(claim.status) && (
              <Notice>
                Another treasurer must review and reimburse your own claim.
              </Notice>
            )}
          {canReview && claim.status === "submitted" && (
            <section className="panel" id="treasurer-review">
              <span className="eyebrow">TREASURER ACTION</span>
              <h2>Review this claim</h2>
              <p className="muted">
                Check the original documents before deciding.
              </p>
              <Field label="Question / reason (required to request information or reject)" id="review-reason">
                <textarea
                  id="review-reason"
                  rows={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <div className="stack-actions">
                <button className="button secondary" disabled={busy || reason.trim().length < 3} onClick={() => action(() => rpc("ml_request_information", { p_claim_id: id, p_question: reason }), "Information requested. Waiting for the claimant’s reply.", "requested")}>{pendingAction === "requested" ? "Sending request…" : "Request missing information"}</button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Approve ${money(claim.amount)} and reserve this activity’s budget? You must still complete the external transfer and record its payment proof.`))
                      void action(
                        () =>
                          rpc("ml_review_claim", {
                            p_claim_id: id,
                            p_decision: "approved",
                            p_reason: "",
                          }),
                        "Claim approved; awaiting payment.",
                        "approved",
                      );
                  }}
                >
                  {pendingAction === "approved" ? "Approving…" : "Approve claim"}
                </button>
                <button
                  className="button danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => {
                    if (!confirm("Reject this claim with the reason you entered? The claimant will be able to revise and resubmit it.")) return;
                    void action(
                      () =>
                        rpc("ml_review_claim", {
                          p_claim_id: id,
                          p_decision: "rejected",
                          p_reason: reason,
                        }),
                      "Claim rejected with your reason.",
                      "rejected",
                    );
                  }}
                >
                  {pendingAction === "rejected" ? "Rejecting…" : "Reject with reason"}
                </button>
              </div>
            </section>
          )}
          {canReview && claim.status === "approved" && (
            <>
              <PaymentForm
                claim={claim}
                payout={payout}
                onDone={() => {
                  state.reload();
                  onChanged?.();
                }}
              />
              <section className="panel">
                <h3>Need another review?</h3>
                <Field label="Reason to revoke approval" id="revoke-reason">
                  <textarea
                    id="revoke-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={1000}
                    rows={2}
                  />
                </Field>
                <button
                  className="button secondary"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => {
                    if (
                      confirm(
                        "Revoke approval and release the reserved budget?",
                      )
                    )
                      void action(
                        () =>
                          rpc("ml_revoke_approval", {
                            p_claim_id: id,
                            p_reason: reason,
                          }),
                        "Approval revoked; claim returned to review.",
                      );
                  }}
                >
                  Revoke approval
                </button>
              </section>
            </>
          )}
          {payment && (
            <section className="panel">
              <span className="eyebrow">REIMBURSEMENT COMPLETE</span>
              <h2>{money(payment.amount)}</h2>
              <dl className="details-list">
                <div>
                  <dt>Paid on</dt>
                  <dd>{payment.paid_on}</dd>
                </div>
                <div>
                  <dt>Reference</dt>
                  <dd>{payment.reference}</dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>{payment.recipient_snapshot.recipient_name}</dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>{payment.recipient_snapshot.provider_name}</dd>
                </div>
                <div>
                  <dt>Account ending</dt>
                  <dd>
                    •••• {payment.recipient_snapshot.account_number.slice(-4)}
                  </dd>
                </div>
              </dl>
              <FileLink
                bucket="payment-proofs"
                path={payment.proof_path}
                label="View payment proof"
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function PaymentForm({
  claim,
  payout,
  onDone,
}: {
  claim: Claim;
  payout: Payout | null;
  onDone: () => void;
}) {
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [proofPath, setProofPath] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const notify = useFeedback();
  const [error, setError] = useOperationError("Payment record could not be saved");
  async function record(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (
      !confirmed ||
      !reference.trim() ||
      !paidOn ||
      paidOn > today() ||
      (!proof && !proofPath)
    ) {
      setError(
        "Complete the payment date, reference, proof and transfer confirmation.",
      );
      return;
    }
    if (!confirm(`Record ${money(claim.amount)} as reimbursed? Confirm the external transfer is complete. MoneyLai will save the evidence, not send money.`)) return;
    setBusy(true);
    notify({ title: feedbackFor("paid", claim.id).pending, tone: "progress" });
    try {
      let path = proofPath;
      if (!path) {
        path = await uploadFile("payment-proofs", claim.id, proof!);
        setProofPath(path);
      }
      await rpc("ml_record_payment", {
        p_claim_id: claim.id,
        p_paid_on: paidOn,
        p_reference: reference.trim(),
        p_proof_path: path,
      });
      notify(feedbackFor("paid", claim.id));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" id="record-payment" aria-busy={busy}>
      <span className="eyebrow">TREASURER ACTION</span>
      <h2>Record reimbursement</h2>
      <p className="muted">
        Transfer {money(claim.amount)} using your bank or e-wallet, then record
        it here. MoneyLai does not transfer money.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {!payout ? (
        <Notice tone="error">
          The member must add payout details before you can record payment.
        </Notice>
      ) : (
        <>
          <div className="payout-card">
            <strong>{payout.recipient_name}</strong>
            <span>{payout.provider_name}</span>
          </div>
          <form onSubmit={record} noValidate>
            <fieldset disabled={busy}>
              <Field label="Payment date" id="paid-on">
                <input
                  id="paid-on"
                  type="date"
                  min={claim.purchase_date ?? undefined}
                  max={today()}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
              </Field>
              <Field label="Transfer reference" id="payment-reference">
                <input
                  id="payment-reference"
                  maxLength={150}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
              <Field
                label="Payment proof"
                id="payment-proof"
                hint="JPG, PNG or PDF, up to 5 MB."
              >
                <input
                  id="payment-proof"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  disabled={Boolean(proofPath)}
                  onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                />
              </Field>
              {proofPath && (
                <p className="small-text">
                  Proof already uploaded. Retry recording this payment, not the
                  transfer.
                </p>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I have completed the external transfer and checked the
                recipient.
              </label>
              <button className="button primary full" disabled={!confirmed}>
                {busy ? "Recording…" : "Mark as reimbursed"}
              </button>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}
