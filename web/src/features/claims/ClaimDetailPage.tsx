"use client";
import Link from "next/link";
import { Journey } from "@/components/Creative";
import ReceiptPreview from "@/components/ReceiptPreview";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import styles from "./ClaimDetailPage.module.css";
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
  getReceiptPlan,
  getAttachments,
  getEvents,
  getPayment,
  getPayout,
  listActivities,
  rpc,
  uploadAttachment,
  removeAttachment,
} from "@/lib/api";
import { claimCode, money, dateTime, errorMessage, fileError } from "@/lib/domain";
import AIClaimCheck from "@/components/AIClaimCheck";
import ReceiptAllocation from "@/components/ReceiptAllocation";
import ClaimClarifications from "@/components/ClaimClarifications";
import TreasuryClaimReview from "@/features/treasury/TreasuryClaimReview";
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
  const { user, profile } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const notify = useFeedback();
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [error, setError] = useOperationError();
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<"receipt" | "supporting">("receipt");
  const [fileVersion, setFileVersion] = useState(0);
  const state = useLoad(async () => {
    const claim = await getClaim(id);
    const [attachments, events, payment, payout, activities, receiptPlan] =
      await Promise.all([
        getAttachments(id),
        getEvents(id),
        getPayment(id),
        getPayout(claim.claimant_id),
        listActivities(),
        getReceiptPlan(id),
      ]);
    return {
      claim,
      attachments,
      events,
      payment,
      payout,
      receiptPlan,
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
  const { claim, attachments, events, payment, payout, activity, receiptPlan } = state.data;
  const owner = claim.claimant_id === user?.id;
  const fiscal = profile?.role === "treasurer";
  const canReview = fiscal && !owner;
  const next = claimNextStep(claim.status, owner, attachments.some((a) => a.kind === "receipt"), Boolean(payout), Boolean(claim.info_requested_at));
  if (canReview) return <Suspense fallback={<Loading />}><TreasuryClaimReview
    {...state.data} busy={busy} pendingAction={pendingAction} error={error} message={message}
    onAction={action} onChanged={() => { state.reload(); onChanged?.(); }}
  /></Suspense>;
  return (
    <div className={`claim-document ${styles.document}`} data-owner={owner} aria-busy={busy}>
      <NextStep {...(owner && claim.status === "draft" ? {
        title: claim.info_requested_at ? "Finish your response" : "Continue your claim",
        description: claim.info_requested_at ? "Update your details, reply to Treasurer, then resubmit." : "Your draft is saved. Continue the guided steps when ready.",
        href: `/claims/${id}/edit${attachments.some(a => a.kind === "receipt") ? "" : "?step=receipt"}`,
        label: claim.info_requested_at ? "Continue response" : "Continue claim",
      } : next)} />
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
      <details className="panel claim-disclosure">
        <summary>Claim progress</summary>
        <Journey status={claim.status} />
      </details>
      {receiptPlan && (Number(claim.amount) !== Number(receiptPlan.calculation.expected_amount) || attachments.filter(a => a.kind === "receipt").length !== 1 || !attachments.some(a => a.id === receiptPlan.attachment_id)) && <Notice tone="error">Receipt selection needs review: the claim amount or original receipt has changed. Open the calculation below.</Notice>}
      <details className="panel claim-disclosure" open={canReview}>
        <summary>Receipt & AI checks{owner ? " (optional)" : ""}</summary>
      {receiptPlan && <ReceiptAllocation plan={receiptPlan} claimed={claim.amount} sourceValid={attachments.filter(a => a.kind === "receipt").length === 1 && attachments.some(a => a.id === receiptPlan.attachment_id)} canEdit={owner && claim.status === "draft"} />}
      <div className="ai-split">
        <ReceiptPreview attachments={attachments} />
        <AIClaimCheck
          compact={owner}
          receiptPlan={receiptPlan}
          claim={claim}
          attachments={attachments}
          onChanged={state.reload}
        />
      </div>
      </details>
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
            {owner && claim.status === "draft" && <details className="claim-disclosure">
              <summary>More draft actions</summary>
              <p>Only a never-submitted draft without attachments can be deleted.</p>
              <button className="text-button danger-text" disabled={busy} onClick={() => {
                if (!confirm("Delete this draft permanently? Remove attachments first.")) return;
                void action(async () => { await rpc("ml_delete_claim", { p_claim_id: id }); router.replace("/claims"); }, "Draft deleted.", "deleted");
              }}>Delete draft</button>
            </details>}
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
          <details className="panel claim-disclosure" id="supporting-documents" open={canReview}>
            <summary>Attached files · {attachments.length}/5</summary>
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
          </details>
          <details className="panel claim-disclosure">
            <summary>Claim history · {events.length + 1} entries</summary>
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
          </details>
        </div>
        <aside>
          {activity && (
            <details className="panel claim-disclosure" open={canReview}>
              <summary>Activity budget</summary>
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
            </details>
          )}
          {fiscal &&
            owner &&
            ["submitted", "approved"].includes(claim.status) && (
              <Notice>
                Another treasurer must review and reimburse your own claim.
              </Notice>
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
