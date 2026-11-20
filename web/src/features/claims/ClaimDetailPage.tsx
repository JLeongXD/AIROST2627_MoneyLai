"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  PageHeader,
  Notice,
  Loading,
  StatusBadge,
  Field,
  FileLink,
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
import { money, dateTime, errorMessage, fileError, today } from "@/lib/domain";
import type { Claim, Payout } from "@/lib/types";
import AIClaimCheck from "@/components/AIClaimCheck";

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  async function action(job: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await job();
      setMessage(success);
      setReason("");
      state.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (state.loading) return <Loading />;
  if (state.error) return <Notice tone="error">{state.error}</Notice>;
  if (!state.data) return null;
  const { claim, attachments, events, payment, payout, activity } = state.data;
  const owner = claim.claimant_id === user?.id;
  const fiscal = profile?.role === "treasurer";
  const canReview = fiscal && !owner;
  return (
    <>
      <PageHeader
        eyebrow={`CLAIM ${id.slice(0, 8).toUpperCase()}`}
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
      <AIClaimCheck
        claim={claim}
        attachments={attachments}
        onChanged={state.reload}
      />
      <div className="detail-grid">
        <div>
          <section className="panel">
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
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    action(
                      () => rpc("ml_submit_claim", { p_claim_id: id }),
                      "Claim submitted for review.",
                    )
                  }
                >
                  Submit for review →
                </button>
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
                      }, "Draft deleted.");
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
          <section className="panel">
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
                  }, "File uploaded.");
                }}
              >
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
            <section className="panel">
              <span className="eyebrow">TREASURER ACTION</span>
              <h2>Review this claim</h2>
              <p className="muted">
                Check the original documents before deciding.
              </p>
              <Field label="Reason (required to reject)" id="review-reason">
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
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Approve this claim and reserve its budget?"))
                      void action(
                        () =>
                          rpc("ml_review_claim", {
                            p_claim_id: id,
                            p_decision: "approved",
                            p_reason: "",
                          }),
                        "Claim approved; awaiting payment.",
                      );
                  }}
                >
                  Approve claim
                </button>
                <button
                  className="button danger"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    action(
                      () =>
                        rpc("ml_review_claim", {
                          p_claim_id: id,
                          p_decision: "rejected",
                          p_reason: reason,
                        }),
                      "Claim rejected with your reason.",
                    )
                  }
                >
                  Reject with reason
                </button>
              </div>
            </section>
          )}
          {canReview && claim.status === "approved" && (
            <>
              <PaymentForm
                claim={claim}
                payout={payout}
                onDone={state.reload}
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
    </>
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
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    setBusy(true);
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
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
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
            <span>
              {reveal
                ? payout.account_number
                : `•••• ${payout.account_number.slice(-4)}`}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? "Hide account" : "Show account for transfer"}
            </button>
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
