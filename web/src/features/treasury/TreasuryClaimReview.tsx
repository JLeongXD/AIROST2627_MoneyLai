"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Activity, Attachment, Claim, ClaimEvent, Payment, Payout } from "@/lib/types";
import type { ReceiptPlan } from "@/lib/ai/receipt-allocation";
import type { ActionKind } from "@/lib/workflow-feedback";
import { claimCode, dateTime, money } from "@/lib/domain";
import { budgetShortfall } from "@/lib/budget";
import { listClaims, rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { useAuth } from "@/components/AuthProvider";
import { Field, FileLink, Notice, StatusBadge } from "@/components/UI";
import ReceiptPreview from "@/components/ReceiptPreview";
import AIClaimCheck from "@/components/AIClaimCheck";
import DuplicateReceipts from "@/components/DuplicateReceipts";
import ReceiptAllocation from "@/components/ReceiptAllocation";
import BudgetNotice from "@/components/BudgetNotice";
import ClaimClarifications from "@/components/ClaimClarifications";
import PaymentForm from "./PaymentForm";
import { queueClaims, queueKey, treasuryQuery } from "./review-queue";
import styles from "./Treasury.module.css";

type Props = {
  claim: Claim; attachments: Attachment[]; events: ClaimEvent[]; payment: Payment | null;
  payout: Payout | null; activity: Activity | undefined; receiptPlan: ReceiptPlan | null;
  busy: boolean; pendingAction: ActionKind | null; error: string; message: string;
  onAction: (job: () => Promise<unknown>, success: string, kind?: ActionKind) => Promise<void>;
  onChanged: () => void;
};

export default function TreasuryClaimReview({ claim, attachments, events, payment, payout, activity, receiptPlan,
  busy, pendingAction, error, message, onAction, onChanged }: Props) {
  const params = useSearchParams();
  const { user } = useAuth();
  const waiting = claim.status === "needs_info" || (claim.status === "draft" && Boolean(claim.info_requested_at));
  const defaultQueue = claim.status === "approved" ? "approved" : ["paid", "rejected", "cancelled"].includes(claim.status) ? "history"
    : waiting ? "needs_info" : "submitted";
  const queue = queueKey(params.get("queue") ?? defaultQueue);
  const search = params.get("search") ?? "";
  const activityFilter = params.get("activity") ?? "";
  const query = treasuryQuery(queue, search, activityFilter);
  const queueState = useLoad(listClaims);
  const candidates = queueClaims((queueState.data ?? []).filter(c => c.claimant_id !== user?.id), queue, search, activityFilter);
  const position = candidates.findIndex(c => c.id === claim.id);
  const next = position >= 0 ? candidates[position + 1] : candidates.find(c => c.id !== claim.id);
  const [decision, setDecision] = useState<"request" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [calculationOpen, setCalculationOpen] = useState(false);
  const [paymentRecorded, setPaymentRecorded] = useState(false);
  const completionMessage = message || (paymentRecorded ? "Reimbursement recorded." : "");
  const sourceValid = !receiptPlan || (attachments.filter(a => a.kind === "receipt").length === 1 && attachments.some(a => a.id === receiptPlan.attachment_id));
  const allocationNeedsAttention = receiptPlan && (!sourceValid || Number(claim.amount) !== Number(receiptPlan.calculation.expected_amount)
    || receiptPlan.calculation.automatic_issue || receiptPlan.calculation.issues.some(issue => issue !== "Member declared all purchases for the activity; review flagged item purposes." || receiptPlan.selection.items.some(i => i.included && i.reason.trim().length < 3)) || receiptPlan.calculation.correction_reason
    || (receiptPlan.selection.mode === "full"
      && (receiptPlan.extraction.total === null || Number(receiptPlan.extraction.total) !== Number(receiptPlan.calculation.receipt_total)))
    || (receiptPlan.selection.mode === "simple" && (receiptPlan.calculation.automatic_amount === null || Number(receiptPlan.calculation.automatic_amount) !== Number(claim.amount))));
  const overBudget = claim.status === "submitted" && budgetShortfall(claim.amount, activity?.remaining_budget) !== null;
  const review = claim.status === "submitted";
  const itemPurposes = sourceValid && receiptPlan ? [...new Set(receiptPlan.selection.items.filter(i => i.included).map(i => i.reason.trim()).filter(Boolean))] : [];
  const purposeSummary = itemPurposes.length ? itemPurposes.join("; ") : claim.description;
  function choose(value: "request" | "reject") { setDecision(value); setReason(""); }
  async function submitDecision() {
    if (!decision || reason.trim().length < 3 || busy) return;
    if (decision === "reject" && !confirm("Reject this claim with the reason you entered? The member can revise and resubmit it.")) return;
    await onAction(() => decision === "request"
      ? rpc("ml_request_information", { p_claim_id: claim.id, p_question: reason.trim() })
      : rpc("ml_review_claim", { p_claim_id: claim.id, p_decision: "rejected", p_reason: reason.trim() }),
    decision === "request" ? "Information requested. Waiting for the member’s reply." : "Claim rejected with your reason.",
    decision === "request" ? "requested" : "rejected");
  }
  return <article className={styles.review} data-status={claim.status} aria-busy={busy}>
    <nav className={styles.reviewNav} aria-label="Review navigation">
      <Link href={`/treasury${query}`}>Back to {queue === "approved" ? "payments" : queue === "history" ? "history" : queue === "needs_info" ? "waiting claims" : "review list"}</Link>
      {position >= 0 && <span>Claim {position + 1} of {candidates.length}</span>}
    </nav>
    <header className={styles.reviewHeader}>
      <div><span className="eyebrow">CLAIM {claimCode(claim)}</span><h1>{claim.claimant?.display_name ?? "Member"}</h1><p>{claim.activity?.name ?? "Expense claim"}</p></div>
      <div className={styles.headerAmount}><strong>{money(claim.amount)}</strong><StatusBadge status={waiting ? "needs_info" : claim.status} /></div>
    </header>
    <p className={styles.intro}>{review ? "Compare the receipt with the claim details, then choose a decision below."
      : claim.status === "approved" ? "This claim is approved. Complete the external transfer, then record payment below."
      : waiting ? "Waiting for the member to update this claim and reply. No decision is needed yet." : "View the receipt, decision and saved records for this claim."}</p>
    {error && <Notice tone="error">{error}</Notice>}
    {completionMessage && <Notice tone="success"><div className={styles.completion}><strong>{completionMessage}</strong>{next
      ? <Link className="button secondary" href={`/treasury/${next.id}${query}`}>Open next claim</Link>
      : <Link className="button secondary" href={`/treasury${query}`}>Back to list</Link>}
      {!paymentRecorded && claim.status === "approved" && <a href="#record-payment">Record this payment</a>}</div></Notice>}
    <div className={styles.reviewGrid}>
      <section className={`panel ${styles.summary}`} aria-labelledby="claim-summary-heading">
        <h2 id="claim-summary-heading">Claim summary</h2>
        <small>{itemPurposes.length ? "Item activity purposes supplied by the member" : "Submitted purpose"}</small>
        <p className={styles.purpose}>{purposeSummary}</p>
        {(purposeSummary !== claim.description || claim.description.length > 220) && <details className={styles.descriptionDetails}><summary>Full purpose & submitted description</summary>
          {purposeSummary !== claim.description && <p>{purposeSummary}</p>}<p>{claim.description}</p>
        </details>}
        <dl className="details-list"><div><dt>Purchase date</dt><dd>{claim.purchase_date ?? "Not added"}</dd></div><div><dt>Category</dt><dd>{claim.category}</dd></div></dl>
        {activity && !overBudget && <div className={styles.budget}><span>Activity budget available</span><strong>{money(activity.remaining_budget)}</strong><small>{claim.status === "approved" || claim.status === "paid" ? "This claim’s amount is already reserved." : "Approval reserves this claim’s amount."}</small></div>}
        {claim.rejection_reason && <Notice><strong>Rejection reason:</strong> {claim.rejection_reason}</Notice>}
      </section>
      <div className={styles.evidence}>
        {attachments.length ? <ReceiptPreview attachments={attachments} autoOpen /> : <Notice tone="error">No receipt files are available. Ask the member to provide the original before deciding.</Notice>}
      </div>
      <section className={`panel ${styles.checks}`} aria-labelledby="review-checks-heading">
        <h2 id="review-checks-heading">Review checks</h2>
        {overBudget && <BudgetNotice amount={claim.amount} available={activity?.remaining_budget} reviewer />}
        {allocationNeedsAttention && <div className={styles.attentionRow}>
          <strong>{!sourceValid ? "Original receipt needs checking" : "Amount or receipt notes need checking"}</strong>
          <a href="#receipt-calculation" onClick={() => setCalculationOpen(true)}>View items & corrections</a>
        </div>}
        <DuplicateReceipts claimId={claim.id} compact embedded claims={queueState.data ?? []} />
        <AIClaimCheck claim={claim} attachments={attachments} receiptPlan={receiptPlan} onChanged={onChanged} compact reviewer embedded />
      </section>
      <div className={styles.decisions}>
        {review && <section className={`panel ${styles.actionPanel}`} id="treasurer-review" aria-labelledby="decision-heading">
          <h2 id="decision-heading">Review decision</h2>
          {overBudget && <p className={styles.approvalHint}>Budget insufficient — resolve the shortfall before approval.</p>}
          <div className={styles.decisionActions}>
          <button className="button primary full" disabled={busy || Boolean(overBudget)} onClick={() => {
            if (busy || overBudget) return;
            if (confirm(`Approve ${money(claim.amount)} and reserve this activity’s budget? You must still complete the external transfer and record its payment proof.`))
              void onAction(() => rpc("ml_review_claim", { p_claim_id: claim.id, p_decision: "approved", p_reason: "" }), "Claim approved; awaiting payment.", "approved");
          }}>{pendingAction === "approved" ? "Approving…" : `Approve ${money(claim.amount)}`}</button>
            <button className="button secondary" disabled={busy} aria-expanded={decision === "request"} aria-controls="decision-form" onClick={() => choose("request")}>Request information</button>
            <button className="text-button danger-text" disabled={busy} aria-expanded={decision === "reject"} aria-controls="decision-form" onClick={() => choose("reject")}>Reject claim</button>
          </div>
          <small>Approval reserves the budget; payment is separate.</small>
          {decision && <form id="decision-form" className={styles.decisionForm} onSubmit={e => { e.preventDefault(); void submitDecision(); }}>
            <Field label={decision === "request" ? "What should the member clarify or correct?" : "Why are you rejecting this claim?"} id="review-reason" hint="The member will see this message.">
              <textarea key={decision} id="review-reason" rows={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} autoFocus required minLength={3} />
            </Field><div className={styles.alternatives}>
              <button className={`button ${decision === "reject" ? "danger" : "primary"}`} disabled={busy || reason.trim().length < 3}>{busy ? "Saving…" : decision === "request" ? "Send request" : "Confirm rejection"}</button>
              <button type="button" className="text-button" disabled={busy} onClick={() => setDecision(null)}>Cancel</button>
            </div>
          </form>}
        </section>}
        {claim.status === "approved" && <>
          <PaymentForm claim={claim} payout={payout} onDone={() => { setPaymentRecorded(true); onChanged(); }} />
          <details className={`panel ${styles.disclosure}`}><summary>Reopen this claim for review</summary><p>Revoking approval releases the reserved budget.</p>
            <Field label="Reason to revoke approval" id="revoke-reason"><textarea id="revoke-reason" rows={2} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></Field>
            <button className="button secondary" disabled={busy || reason.trim().length < 3} onClick={() => {
              if (confirm("Revoke approval and release the reserved budget?")) void onAction(() => rpc("ml_revoke_approval", { p_claim_id: claim.id, p_reason: reason.trim() }), "Approval revoked; claim returned to review.");
            }}>Revoke approval</button>
          </details>
        </>}
        {waiting && <Notice>The member’s response will appear here when they resubmit.</Notice>}
        {payment && <section className="panel"><h2>Reimbursement recorded</h2><dl className="details-list">
          <div><dt>Amount</dt><dd>{money(payment.amount)}</dd></div><div><dt>Paid on</dt><dd>{payment.paid_on}</dd></div>
          <div><dt>Reference</dt><dd>{payment.reference}</dd></div><div><dt>Recipient</dt><dd>{payment.recipient_snapshot.recipient_name}</dd></div>
          <div><dt>Provider</dt><dd>{payment.recipient_snapshot.provider_name}</dd></div><div><dt>Account ending</dt><dd>•••• {payment.recipient_snapshot.account_number.slice(-4)}</dd></div>
        </dl><FileLink bucket="payment-proofs" path={payment.proof_path} label="View payment proof" /></section>}
      </div>
      <div className={styles.more}>
        {(claim.info_requested_at || events.some(e => /information|clarif/.test(e.event_type))) && <details className={`panel ${styles.disclosure}`} open={waiting}><summary>Questions & replies</summary>
          <ClaimClarifications claim={claim} owner={false} onChanged={onChanged} />
        </details>}
        {receiptPlan && <details className={`panel ${styles.disclosure}`} id="receipt-calculation" open={calculationOpen} onToggle={e => setCalculationOpen(e.currentTarget.open)}><summary>Amount calculation & selected items</summary>
          <ReceiptAllocation plan={receiptPlan} claimed={claim.amount} sourceValid={sourceValid} canEdit={false} />
        </details>}
        <details className={`panel ${styles.disclosure}`}><summary>Claim history · {events.length + 1} entries</summary>
          <p>Submitted {dateTime(claim.submitted_at)}</p><ol className="timeline">{events.map(e => <li key={e.id}><strong>{e.event_type.replaceAll("_", " ")}</strong><p>{e.note}</p>
            <small>{e.actor?.display_name ?? String(e.snapshot.actor_name ?? "Club officer")} · {dateTime(e.created_at)}</small>
            {e.snapshot.amount !== undefined && <small>Recorded amount: {money(String(e.snapshot.amount))}</small>}</li>)}
            <li><strong>Draft created</strong><small>{dateTime(claim.created_at)}</small></li></ol>
        </details>
        {next && !completionMessage && <Link className="button secondary" href={`/treasury/${next.id}${query}`}>Open next claim</Link>}
      </div>
    </div>
  </article>;
}
