import type { Money } from "@/lib/types";
import { money } from "@/lib/domain";
import { budgetShortfall } from "@/lib/budget";
import styles from "./BudgetNotice.module.css";

export default function BudgetNotice({ amount, available, reviewer = false }: {
  amount: Money | null | undefined; available: Money | null | undefined; reviewer?: boolean;
}) {
  const shortfall = budgetShortfall(amount, available);
  if (shortfall === null) return null;
  return <aside className={styles.notice} role={reviewer ? "alert" : "status"} aria-label="Activity budget insufficient">
    <strong>Activity budget insufficient</strong>
    <dl className={styles.amounts}>
      <div><dt>Available activity budget</dt><dd>{money(available)}</dd></div>
      <div><dt>This claim</dt><dd>{money(amount)}</dd></div>
      <div><dt>Over budget by</dt><dd>{money(shortfall)}</dd></div>
    </dl>
    <p>{reviewer
      ? "Resolve the budget shortfall before approving. Request information from the member or arrange a budget increase through President approval."
      : "You can still submit this claim. Treasurer must resolve the activity budget shortfall before approval."}</p>
  </aside>;
}
