import Link from "next/link";
import { Notice } from "./UI";
import { money, dateTime } from "@/lib/domain";
import type { ReceiptPlan } from "@/lib/ai/receipt-allocation";
import styles from "./ReceiptAssistant.module.css";
export default function ReceiptAllocation({ plan, claimed, sourceValid, canEdit }: { plan: ReceiptPlan; claimed: string | number; sourceValid: boolean; canEdit: boolean }) {
  const result = plan.calculation;
  const different = Number(claimed) !== Number(result.expected_amount);
  return <section className="panel" id="receipt-allocation">
    <h2>Receipt & claim amount</h2>
    {!sourceValid && <Notice tone="error">The original receipt for this selection was removed or additional receipts were added. Revise the selection before relying on this calculation.</Notice>}
    <div className={styles.claimAmount}><span>Claim amount</span><strong>{money(claimed)}</strong></div>
    <dl className={styles.amountSummary}>
      <div><dt>Confirmed receipt total</dt><dd>{money(result.receipt_total)}</dd></div>
      <div><dt>Claiming</dt><dd>{plan.selection.mode === "full" ? "Full receipt" : "Selected items / partial amount"}</dd></div>
    </dl>
    {sourceValid && !different && <p className={styles.match}>✓ Your claim matches the saved {plan.selection.mode === "full" ? "receipt total" : "reimbursement amount"}.</p>}
    {plan.selection.mode === "full" && <p>The member confirmed all purchases were for this activity.</p>}
    {different && <Notice tone="error">Amount difference: {money(Number(claimed) - Number(result.expected_amount))}. Check the confirmed items and adjustments before submitting or approving.</Notice>}
    {plan.selection.mode === "full" && (plan.extraction.total === null || Number(plan.extraction.total) !== Number(result.receipt_total)) && <Notice tone="error">AI original total is missing or differs from the member-confirmed total. Verify the original and correction reason.</Notice>}
    {plan.selection.mode === "simple" && <Notice tone={result.automatic_amount === null || Number(result.automatic_amount) !== Number(claimed) ? "error" : "info"}>Automatic allocation: {result.automatic_amount == null ? "Could not be verified" : money(result.automatic_amount)} · member-confirmed amount: {money(claimed)}. {plan.selection.claimed_amount !== undefined ? "Manually confirmed; check the reason and original." : "Check the original before approval."}</Notice>}
    {plan.selection.mode === "simple" && plan.selection.claimed_amount !== undefined && <div className={styles.facts}>
      <strong>Member-corrected amount · Treasurer must verify the original.</strong>
      <span>AI-read receipt total: {plan.extraction.total === null ? "Unclear" : money(plan.extraction.total)}</span>
      {result.automatic_amount != null && <span>Difference from automatic calculation: {Number(claimed) > Number(result.automatic_amount) ? "+" : ""}{money(Number(claimed) - Number(result.automatic_amount))}</span>}
      <span>Correction reason: {plan.selection.override_reason}</span>
    </div>}
    <details className={styles.disclosure}>
    <summary>View items & corrections</summary>
    <p>These are saved member confirmations, not independent AI verification. Treasurer still needs to check the original and any corrections.</p>
    <p>AI original total: {plan.extraction.total === null ? "Unclear" : money(plan.extraction.total)} · {plan.selection.mode === "simple" ? "Member-confirmed reimbursement" : "Calculated reimbursement"}: {money(result.expected_amount)}</p>
    {plan.selection.mode === "full" && <p>The confirmed total includes charges and discounts. No separate allocation.</p>}
    <div className={styles.items}>{plan.selection.items.map(row => {
      const original = plan.extraction.items.find(i => i.id === row.id);
      return <article className={styles.item} key={row.id}><strong>{row.included ? "Included" : "Excluded"} · {original?.description ?? row.id}</strong><p>AI line total: {original?.amount === null || original?.amount === undefined ? "Unclear" : money(original.amount)}{plan.selection.mode !== "full" && <> → confirmed {row.amount === "" ? "Unclear" : money(row.amount)}</>}</p><p>{row.reason || "No additional note."}</p></article>;
    })}</div>
    {plan.selection.mode !== "full" && <>
    {result.automatic_issue ? <p>Selected item subtotal: {result.selected_subtotal === null ? "Unclear" : money(result.selected_subtotal)}. Automatic adjustment allocation is unavailable. Do not interpret unknown charges as zero.</p> : <p>Selected items {money(result.selected_subtotal)} + allocated tax {money(result.tax)} − discount {money(result.discount)} + rounding {money(result.rounding)} = <b>{money(result.automatic_amount ?? result.expected_amount)}</b>.</p>}
    <p>Excluded items: {result.automatic_issue && result.selected_subtotal === null ? "Unverified" : money(result.excluded_subtotal)} · Method: {result.method}</p>
    </>}
    {result.adjustment_reason && <p><b>Adjustment basis:</b> {result.adjustment_reason}</p>}
    {result.correction_reason && <p><b>Correction explanation:</b> {result.correction_reason}</p>}
    {result.issues.map((issue, i) => <Notice key={i}>{issue}</Notice>)}
    <small>Revision {plan.revision} · {dateTime(plan.updated_at)} · {plan.model}. Original readings and each saved revision are retained.</small>
    </details>
    {canEdit && <p><Link href={`/claims/${plan.claim_id}/edit`}>Edit confirmed items and explanations →</Link></p>}
  </section>;
}
