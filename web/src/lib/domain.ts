import type { ClaimStatus, Money } from "./types";
export const CATEGORIES = [
  "Materials",
  "Food & Drinks",
  "Transport",
  "Venue",
  "Equipment",
  "Other",
] as const;
export const STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Pending review",
  needs_info: "Needs information",
  approved: "Awaiting payment",
  rejected: "Rejected",
  paid: "Reimbursed",
  cancelled: "Cancelled (historical)",
};
export function claimCode(claim: { id: string; claim_number?: number | string }) {
  return claim.claim_number == null ? `ML / ${claim.id.slice(0, 6).toUpperCase()}` : `ML-${String(claim.claim_number).padStart(6, "0")}`;
}
export function money(value: Money | null | undefined) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(Number(value ?? 0));
}
export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}
export function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function amountError(value: string, allowZero = false): string | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim()))
    return "Enter an amount with at most two decimal places (maximum RM9,999,999,999.99).";
  if (Number(value) < 0 || (!allowZero && Number(value) === 0))
    return "Amount must be greater than zero.";
  return null;
}
export function fileError(file: Pick<File, "size" | "type">): string | null {
  if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type))
    return "Choose a JPG, PNG or PDF file.";
  if (file.size <= 0 || file.size > 5 * 1024 * 1024)
    return "File size must be between 1 byte and 5 MB.";
  return null;
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return "Something went wrong. Please try again.";
}
