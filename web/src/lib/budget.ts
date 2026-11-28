import type { Money } from "./types";
import { decimal, sen } from "./ai/receipt-allocation";

export function budgetShortfall(amount: Money | null | undefined, available: Money | null | undefined): string | null {
  const claim = sen(String(amount ?? "").trim());
  const remaining = sen(String(available ?? "").trim(), true);
  if (claim === null || claim <= 0 || remaining === null || claim <= remaining) return null;
  return decimal(claim - remaining);
}
