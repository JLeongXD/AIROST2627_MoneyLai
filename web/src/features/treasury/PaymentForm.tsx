"use client";
import { useState, type FormEvent } from "react";
import type { Claim, Payout } from "@/lib/types";
import { today, money, errorMessage } from "@/lib/domain";
import { rpc, uploadFile } from "@/lib/api";
import { Field, Notice } from "@/components/UI";
import { useFeedback, useOperationError } from "@/components/FeedbackProvider";
import { feedbackFor } from "@/lib/workflow-feedback";

export default function PaymentForm({
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
            <span>Account: {payout.account_number}</span>
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
