// Shared validation and sen-based arithmetic; the server repeats every calculation.
export type ReceiptExtraction = {
  readable: boolean; merchant: string | null; receipt_number: string | null; date: string | null;
  currency: string | null; total: string | null; tax: string | null; discount: string | null; rounding: string | null;
  line_amount_basis: "net" | "gross" | "unknown";
  document_type: "receipt" | "invoice" | "quotation" | "order_confirmation" | "other" | "unknown";
  payment_status: "paid" | "unpaid" | "unknown";
  items: { id: string; description: string; quantity: string | null; amount: string | null; relevance: "likely_activity" | "needs_confirmation"; reason: string }[];
  suggested_category: string; suggested_description: string; warnings: string[];
  purpose_clear: boolean; purpose_note: string;
};
export type ReceiptSelection = {
  items: { id: string; included: boolean; amount: string; reason: string }[];
  receipt_total: string; mode: "proportional" | "manual";
  tax: string; discount: string; rounding: string;
  adjustment_reason: string; correction_reason: string; confirmed: boolean;
};
export type Allocation = {
  receipt_total: string; raw_receipt_total: string | null; selected_subtotal: string; excluded_subtotal: string;
  tax: string; discount: string; rounding: string; expected_amount: string;
  method: string; adjustment_reason: string; correction_reason: string; issues: string[];
};
export type ReceiptPlan = {
  claim_id: string; session_id: string; attachment_id: string | null; revision: number;
  extraction: ReceiptExtraction; selection: ReceiptSelection; calculation: Allocation;
  sha256: string; model: string; original_name: string; created_at: string; updated_at: string;
  source_valid?: boolean; // Export snapshot only; live views check the attached receipts directly.
};
export type ReceiptAssistantValue = { sessionId: string; extraction: ReceiptExtraction; selection: ReceiptSelection };
const categories = ["Materials", "Food & Drinks", "Transport", "Venue", "Equipment", "Other"];
export function sen(value: unknown, signed = false): number | null {
  if (typeof value !== "string" || !(signed ? /^-?\d{1,10}(\.\d{1,2})?$/ : /^\d{1,10}(\.\d{1,2})?$/).test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, decimal = ""] = value.replace("-", "").split(".");
  return (Number(whole) * 100 + Number(decimal.padEnd(2, "0"))) * (negative ? -1 : 1);
}
export const decimal = (n: number) => `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`;
const text = (v: unknown, max = 1000): v is string => typeof v === "string" && v.length <= max;
function fail(message: string): never { throw new Error(message); }
export function validateReceiptExtraction(value: unknown): ReceiptExtraction {
  if (!value || typeof value !== "object") fail("AI returned an invalid receipt reading.");
  const r = value as ReceiptExtraction;
  if (typeof r.readable !== "boolean" || !["net", "gross", "unknown"].includes(r.line_amount_basis) ||
    !["receipt", "invoice", "quotation", "order_confirmation", "other", "unknown"].includes(r.document_type) ||
    !["paid", "unpaid", "unknown"].includes(r.payment_status) || !categories.includes(r.suggested_category) ||
    !text(r.suggested_description, 500) || typeof r.purpose_clear !== "boolean" || !text(r.purpose_note) || !Array.isArray(r.items) || r.items.length > 100 ||
    !Array.isArray(r.warnings) || r.warnings.length > 10 || !r.warnings.every(w => text(w))) fail("AI returned incomplete receipt fields.");
  for (const field of ["merchant", "receipt_number"] as const) if (r[field] !== null && !text(r[field], 200)) fail("Invalid merchant or receipt number.");
  if (r.currency !== null && (!text(r.currency, 3) || !/^[A-Z]{3}$/.test(r.currency))) fail("Invalid receipt currency.");
  if (r.date !== null && (!text(r.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date)) || new Date(r.date).toISOString().slice(0, 10) !== r.date)) fail("Invalid receipt date.");
  for (const field of ["total", "tax", "discount", "rounding"] as const) if (r[field] !== null && sen(r[field], field === "rounding") === null) fail("Invalid receipt amount.");
  const ids = new Set<string>();
  for (const item of r.items) {
    if (!item || !text(item.id, 30) || !/^[a-zA-Z0-9_-]+$/.test(item.id) || ids.has(item.id) || !text(item.description, 300) ||
      !item.description.trim() || !text(item.reason) || !["likely_activity", "needs_confirmation"].includes(item.relevance) ||
      !(item.quantity === null || text(item.quantity, 40)) || !(item.amount === null || sen(item.amount) !== null)) fail("AI returned invalid or duplicated item lines.");
    ids.add(item.id);
  }
  // Strip unexpected properties before persisting model output.
  return { readable: r.readable, merchant: r.merchant, receipt_number: r.receipt_number, date: r.date, currency: r.currency,
    total: r.total, tax: r.tax, discount: r.discount, rounding: r.rounding, line_amount_basis: r.line_amount_basis,
    document_type: r.document_type, payment_status: r.payment_status, suggested_category: r.suggested_category,
    suggested_description: r.suggested_description, warnings: r.warnings, purpose_clear: r.purpose_clear, purpose_note: r.purpose_note,
    items: r.items.map(i => ({ id: i.id, description: i.description, quantity: i.quantity, amount: i.amount, relevance: i.relevance, reason: i.reason })) };
}
export function initialSelection(r: ReceiptExtraction): ReceiptSelection {
  return { items: r.items.map(i => ({ id: i.id, included: true, amount: i.amount ?? "", reason: "" })),
    receipt_total: r.total ?? "", mode: "proportional", tax: "0.00", discount: "0.00", rounding: "0.00",
    adjustment_reason: "", correction_reason: "", confirmed: false };
}
// Half-up rational allocation uses BigInt, never binary floating-point money multiplication.
const share = (adjustment: number, selected: number, total: number) => {
  const n = BigInt(Math.abs(adjustment)) * BigInt(selected), d = BigInt(total);
  return Number((n * BigInt(2) + d) / (d * BigInt(2))) * Math.sign(adjustment);
};
export function calculateAllocation(raw: ReceiptExtraction, input: unknown): Allocation {
  if (!input || typeof input !== "object") fail("Confirm the receipt selections first.");
  const s = input as ReceiptSelection;
  if (s.confirmed !== true || !Array.isArray(s.items) || s.items.length !== raw.items.length || !s.items.length ||
    !["proportional", "manual"].includes(s.mode) || sen(s.tax) === null || sen(s.discount) === null || sen(s.rounding, true) === null ||
    !text(s.adjustment_reason) || !text(s.correction_reason)) fail("Review and confirm all receipt selections.");
  if (raw.currency !== "MYR") fail("This first version supports MYR receipts. Use manual entry for other or unknown currencies.");
  const total = sen(s.receipt_total);
  if (total === null || total <= 0) fail("Confirm a positive receipt total.");
  const ids = new Set<string>();
  let selected = 0, excluded = 0, corrected = sen(raw.total) !== total;
  const issues = [...raw.warnings];
  for (const item of s.items) {
    const original = raw.items.find(i => i.id === item?.id);
    const n = sen(item?.amount);
    if (!original || ids.has(item.id) || typeof item.included !== "boolean" || n === null || !text(item.reason)) fail("Each original item must occur exactly once with a valid amount.");
    ids.add(item.id);
    if (!item.included && item.reason.trim().length < 3) fail("Explain why each excluded item is not being claimed (at least 3 characters).");
    if (item.included && original.relevance === "needs_confirmation" && item.reason.trim().length < 3) fail("Explain the activity purpose of each item marked for confirmation.");
    if (sen(original.amount) !== n) corrected = true;
    if (item.included) selected += n; else excluded += n;
  }
  if (!selected) fail("Select at least one item with a positive amount.");
  if (corrected && s.correction_reason.trim().length < 3) fail("Explain any correction to the AI amounts or receipt total.");
  let tax = 0, discount = 0, rounding = 0;
  const all = selected + excluded;
  if (s.mode === "proportional") {
    if (corrected) fail("Use manual adjustments when correcting AI amounts; explain your calculation.");
    if (raw.line_amount_basis === "gross") {
      if (all !== total) fail("Item lines do not reconcile with the receipt total. Use manual adjustments.");
    } else if (raw.line_amount_basis === "net") {
      const t = sen(raw.tax), d = sen(raw.discount), r = sen(raw.rounding, true);
      if (t === null || d === null || r === null || all + t - d + r !== total) fail("Receipt adjustments are uncertain. Use manual adjustments and explain them.");
      tax = share(t, selected, all); discount = share(d, selected, all); rounding = share(r, selected, all);
    } else fail("The receipt's tax basis is unclear. Use manual adjustments.");
    if (excluded > 0 && s.adjustment_reason.trim().length < 3) fail("Confirm why proportional adjustments apply uniformly, or choose manual adjustments.");
  } else {
    const t = sen(s.tax), d = sen(s.discount), r = sen(s.rounding, true);
    if (t === null || d === null || r === null || Math.abs(r) > 100 || t > total || d > total) fail("Enter valid allocated adjustments; rounding must be within RM1.00.");
    if (s.adjustment_reason.trim().length < 3) fail("Explain the manual tax, discount and rounding allocation.");
    tax = t; discount = d; rounding = r;
    issues.push("Manual adjustment allocation: Treasurer should verify its basis.");
    if (raw.line_amount_basis === "gross" && (tax !== 0 || discount !== 0 || rounding !== 0)) issues.push("AI classified item prices as including adjustments, but extra adjustments were entered. Check for double counting.");
  }
  const expected = selected + tax - discount + rounding;
  if (expected <= 0 || expected > total) fail("Calculated reimbursement must be positive and cannot exceed the confirmed receipt total.");
  if (!raw.readable) issues.push("Original receipt was not reliably readable.");
  if (raw.document_type !== "receipt") issues.push(`Document classified as ${raw.document_type}; confirm this is acceptable evidence of payment.`);
  if (raw.payment_status !== "paid") issues.push(`Payment status is ${raw.payment_status}; confirm payment evidence.`);
  if (corrected) issues.push("User corrected AI amounts; compare the correction reason with the original receipt.");
  return { receipt_total: decimal(total), raw_receipt_total: raw.total, selected_subtotal: decimal(selected), excluded_subtotal: decimal(excluded),
    tax: decimal(tax), discount: decimal(discount), rounding: decimal(rounding), expected_amount: decimal(expected),
    method: s.mode, adjustment_reason: s.adjustment_reason.trim(), correction_reason: s.correction_reason.trim(), issues: [...new Set(issues)] };
}
