import Link from "next/link";
import { Notice } from "./UI";
import { money, dateTime } from "@/lib/domain";
import type { ReceiptPlan } from "@/lib/ai/receipt-allocation";
import styles from "./ReceiptAssistant.module.css";
export default function ReceiptAllocation({ plan, claimed, sourceValid, canEdit }: { plan: ReceiptPlan; claimed: string | number; sourceValid: boolean; canEdit: boolean }) {
  const result = plan.calculation;
  const different = Number(claimed) !== Number(result.expected_amount);
  return <section className="panel" id="receipt-allocation">
    <span className="eyebrow">ORIGINAL → CONFIRMED ITEMS → CLAIM</span>
    <h2>Receipt item reconciliation</h2>
    {!sourceValid && <Notice tone="error">The original receipt for this selection was removed or additional receipts were added. Revise the selection before relying on this calculation.</Notice>}
    <div className={styles.facts}><span>AI original total: {plan.extraction.total === null ? "Unclear" : money(plan.extraction.total)}</span><span>Confirmed full receipt: {money(result.receipt_total)}</span><strong>Calculated reimbursement: {money(result.expected_amount)}</strong><span>Current claim: {money(claimed)}</span></div>
    {different ? <Notice tone="error">Amount difference: {money(Number(claimed) - Number(result.expected_amount))}. The current claim differs from the confirmed items and adjustments. Explain or correct this before approval.</Notice> : <Notice>Claim amount matches the saved item calculation. Treasurer still needs to review the original and the allocation basis.</Notice>}
    <div className={styles.items}>{plan.selection.items.map(row => {
      const original = plan.extraction.items.find(i => i.id === row.id);
      return <article className={styles.item} key={row.id}><strong>{row.included ? "Included" : "Excluded"} · {original?.description ?? row.id}</strong><p>AI line total: {original?.amount === null || original?.amount === undefined ? "Unclear" : money(original.amount)} → confirmed {money(row.amount)}</p><p>{row.reason || "No additional note."}</p></article>;
    })}</div>
    <p>Selected items {money(result.selected_subtotal)} + allocated tax {money(result.tax)} − discount {money(result.discount)} + rounding {money(result.rounding)} = <b>{money(result.expected_amount)}</b>.</p>
    <p>Excluded items: {money(result.excluded_subtotal)} · Method: {result.method}</p>
    {result.adjustment_reason && <p><b>Adjustment basis:</b> {result.adjustment_reason}</p>}
    {result.correction_reason && <p><b>Correction explanation:</b> {result.correction_reason}</p>}
    {result.issues.map((issue, i) => <Notice key={i}>{issue}</Notice>)}
    <small>Revision {plan.revision} · {dateTime(plan.updated_at)} · {plan.model}. Original readings and each saved revision are retained.</small>
    {canEdit && <p><Link href={`/claims/${plan.claim_id}/edit`}>Edit confirmed items and explanations →</Link></p>}
  </section>;
}
