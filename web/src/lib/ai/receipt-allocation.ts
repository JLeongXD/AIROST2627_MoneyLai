// Shared validation and sen-based arithmetic; the server repeats every calculation.
export type AdjustmentTreatment = { tax: "included" | "additional" | "none" | "unknown"; discount: "included" | "additional" | "none" | "unknown"; rounding: "included" | "additional" | "none" | "unknown"; uniform: boolean; tax_scope?: "all_items" | "mixed" | "unknown" };
export type ReceiptExtraction = {
  adjustment_treatment?: AdjustmentTreatment;
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
  receipt_total: string; mode: "full" | "simple" | "auto" | "proportional" | "manual";
  claimed_amount?: string; override_reason?: string;
  adjustment_treatment?: AdjustmentTreatment;
  tax: string; discount: string; rounding: string;
  adjustment_reason: string; correction_reason: string; confirmed: boolean;
};
export type Allocation = {
  receipt_total: string; raw_receipt_total: string | null; selected_subtotal: string | null; excluded_subtotal: string;
  tax: string | null; discount: string | null; rounding: string | null; expected_amount: string;
  method: string; adjustment_reason: string; correction_reason: string; issues: string[];
  automatic_amount?: string | null; automatic_issue?: string | null;
};
export type ReceiptPlan = {
  claim_id: string; session_id: string; attachment_id: string | null; revision: number;
  extraction: ReceiptExtraction; selection: ReceiptSelection; calculation: Allocation;
  sha256: string; model: string; original_name: string; created_at: string; updated_at: string;
  source_valid?: boolean; // Export snapshot only; live views check the attached receipts directly.
};
export type ReceiptAssistantValue = { sessionId: string; extraction: ReceiptExtraction; selection: ReceiptSelection };
export function receiptItemReasonError(raw: ReceiptExtraction, selection: ReceiptSelection, index: number): string | null {
  const row = selection.items[index], item = raw.items.find(i => i.id === row?.id);
  if (!row || !item || row.reason.trim().length >= 3) return null;
  return row.included ? `Enter the activity purpose for “${item.description}” (at least 3 characters).`
    : `Explain why “${item.description}” is excluded (at least 3 characters).`;
}
export function receiptPurposeDescription(raw: ReceiptExtraction, selection: ReceiptSelection): string {
  const groups = new Map<string, string[]>();
  for (const row of selection.items) {
    if (!row.included) continue;
    const item = raw.items.find(i => i.id === row.id);
    if (!item || row.reason.trim().length < 3) fail("Enter an activity purpose for every selected purchase first.");
    const purpose = row.reason.trim();
    groups.set(purpose, [...(groups.get(purpose) ?? []), item.description]);
  }
  if (!groups.size) return selection.mode === "full" && !raw.items.length ? raw.suggested_description : "";
  const description = `Purchase${raw.merchant ? ` from ${raw.merchant}` : ""}: ` +
    [...groups].map(([purpose, items]) => `${items.join(", ")} — ${purpose}`).join("; ");
  if (description.length <= 500) return description;
  const suffix = "… Full item purposes are saved in the receipt details.";
  return description.slice(0, 500 - suffix.length).trimEnd() + suffix;
}
const categories = ["Materials", "Food & Drinks", "Transport", "Venue", "Equipment", "Other"];
export function sen(value: unknown, signed = false): number | null {
  if (typeof value !== "string" || !(signed ? /^-?\d{1,10}(\.\d{1,2})?$/ : /^\d{1,10}(\.\d{1,2})?$/).test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, decimal = ""] = value.replace("-", "").split(".");
  return (Number(whole) * 100 + Number(decimal.padEnd(2, "0"))) * (negative ? -1 : 1);
}
export const decimal = (n: number) => `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`;
export function receiptItemTotals(items: ReceiptSelection["items"]): { selected: number; excluded: number } | null {
  if (!items.length) return null;
  let selected = 0, excluded = 0;
  for (const row of items) {
    const amount = sen(row.amount);
    if (amount === null) return null;
    if (row.included) selected += amount; else excluded += amount;
  }
  return { selected, excluded };
}
// An explicit member action, kept separate from the automatic baseline.
export function confirmSelectedItemAmount(selection: ReceiptSelection): ReceiptSelection {
  const totals = receiptItemTotals(selection.items), total = sen(selection.receipt_total);
  if (selection.mode !== "simple" || !totals || totals.selected <= 0 || total === null || total <= 0)
    fail("Check the selected item amounts and final receipt total first.");
  return { ...selection, claimed_amount: decimal(totals.selected), confirmed: true,
    override_reason: `I checked the original and confirm the selected item total of RM ${decimal(totals.selected)}; excluded purchases total RM ${decimal(totals.excluded)}. No extra adjustments are claimed.` };
}
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
  if (r.adjustment_treatment !== undefined && !validTreatment(r.adjustment_treatment)) fail("Invalid adjustment treatment.");
  // Strip unexpected properties before persisting model output.
  return { readable: r.readable, merchant: r.merchant, receipt_number: r.receipt_number, date: r.date, currency: r.currency,
    total: r.total, tax: r.tax, discount: r.discount, rounding: r.rounding, line_amount_basis: r.line_amount_basis,
    ...(r.adjustment_treatment ? { adjustment_treatment: { ...r.adjustment_treatment } } : {}),
    document_type: r.document_type, payment_status: r.payment_status, suggested_category: r.suggested_category,
    suggested_description: r.suggested_description, warnings: r.warnings, purpose_clear: r.purpose_clear, purpose_note: r.purpose_note,
    items: r.items.map(i => ({ id: i.id, description: i.description, quantity: i.quantity, amount: i.amount, relevance: i.relevance, reason: i.reason })) };
}
function validTreatment(t: AdjustmentTreatment) {
  return t && typeof t.uniform === "boolean" && (t.tax_scope === undefined || ["all_items", "mixed", "unknown"].includes(t.tax_scope)) &&
    (["tax", "discount", "rounding"] as const).every(k => ["included", "additional", "none", "unknown"].includes(t[k]));
}
export function receiptTreatment(r: ReceiptExtraction): AdjustmentTreatment {
  const treatment = (key: "tax" | "discount" | "rounding") => r.line_amount_basis === "gross" ? "included" : r[key] === null ? "unknown" : sen(r[key], key === "rounding") === 0 ? "none" : r.line_amount_basis === "net" ? "additional" : "unknown";
  const result: AdjustmentTreatment = r.adjustment_treatment ? { ...r.adjustment_treatment } : { tax: treatment("tax"), discount: treatment("discount"), rounding: treatment("rounding"), uniform: false };
  const totals = receiptItemTotals(r.items.map(i => ({ ...i, included: true, amount: i.amount ?? "" })));
  // Reconcile against the original, never a user-edited total. Missing or zero
  // adjustments need no extra allocation when every line already sums to it.
  if (totals && totals.selected > 0 && totals.selected === sen(r.total)) {
    for (const key of ["tax", "discount", "rounding"] as const) {
      if (result[key] === "unknown" && (r[key] === null || sen(r[key], key === "rounding") === 0)) result[key] = "none";
    }
  }
  return result;
}
export function initialSelection(r: ReceiptExtraction, mode: "full" | "auto" | "simple" = "full"): ReceiptSelection {
  return { items: r.items.map(i => ({ id: i.id, included: true, amount: i.amount ?? "", reason: "" })),
    receipt_total: r.total ?? "", mode, tax: mode === "full" ? "" : r.tax ?? "", discount: mode === "full" ? "" : r.discount ?? "", rounding: mode === "full" ? "" : r.rounding ?? "",
    adjustment_treatment: receiptTreatment(r),
    adjustment_reason: "", correction_reason: "", confirmed: false };
}
export function automaticReceiptAllocation(raw: ReceiptExtraction, selection: ReceiptSelection): Allocation {
  // The preview calculates money while answers are still being entered. Saving
  // and proceeding always use calculateAllocation, which requires every answer.
  return allocate(raw, { ...selection, mode: "auto", tax: raw.tax ?? "", discount: raw.discount ?? "", rounding: raw.rounding ?? "",
    adjustment_treatment: receiptTreatment(raw), confirmed: true }, false);
}
// Convert only editable drafts; original saved plans and audit history stay untouched.
export function editableReceiptSelection(raw: ReceiptExtraction, saved: ReceiptSelection): ReceiptSelection {
  if (saved.mode === "full" || saved.mode === "simple") return saved;
  const next = { ...initialSelection(raw, "simple"), receipt_total: saved.receipt_total,
    items: raw.items.map(i => ({ id: i.id, amount: i.amount ?? "", included: saved.items.find(s => s.id === i.id)?.included ?? true,
      reason: saved.items.find(s => s.id === i.id)?.reason ?? "" })), correction_reason: saved.correction_reason };
  if (saved.mode === "manual") {
    try { return { ...next, claimed_amount: calculateAllocation(raw, { ...saved, confirmed: true }).expected_amount,
      override_reason: saved.adjustment_reason || "Previously confirmed manual allocation." }; } catch { /* User reconfirms unresolved old drafts. */ }
  }
  return next;
}
// Half-up rational allocation uses BigInt, never binary floating-point money multiplication.
const share = (adjustment: number, selected: number, total: number) => {
  const n = BigInt(Math.abs(adjustment)) * BigInt(selected), d = BigInt(total);
  return Number((n * BigInt(2) + d) / (d * BigInt(2))) * Math.sign(adjustment);
};
export function calculateAllocation(raw: ReceiptExtraction, input: unknown): Allocation {
  return allocate(raw, input, true);
}
function allocate(raw: ReceiptExtraction, input: unknown, requireItemReasons: boolean): Allocation {
  if (!input || typeof input !== "object") fail("Confirm the receipt selections first.");
  const s = input as ReceiptSelection;
  if (raw.currency !== "MYR") fail("This version supports MYR receipts. Use manual entry for other currencies.");
  if (s.mode === "simple") {
    const total = sen(s.receipt_total);
    if (s.confirmed !== true || total === null || total <= 0 || !text(s.correction_reason) || !Array.isArray(s.items) || s.items.length !== raw.items.length) fail("Confirm the receipt total and selected purchases.");
    const ids = new Set<string>(); let selected = 0;
    for (const row of s.items) {
      const original = raw.items.find(i => i.id === row?.id);
      if (!original || ids.has(row.id) || typeof row.included !== "boolean" || row.amount !== (original.amount ?? "") || !text(row.reason)) fail("Select each original item once; use the reimbursement correction to change the claim amount.");
      ids.add(row.id); if (row.included) selected++;
      if (requireItemReasons && row.reason.trim().length < 3) fail(row.included ? `Enter the activity purpose for “${original.description}” (at least 3 characters).` : `Explain why “${original.description}” is excluded (at least 3 characters).`);
    }
    if (!selected) fail("Select at least one activity purchase.");
    if (sen(raw.total) !== total && s.correction_reason.trim().length < 3) fail("Explain the receipt total you entered or corrected from the original.");
    let automatic: Allocation | null = null, automaticIssue: string | null = null;
    try { automatic = automaticReceiptAllocation(raw, s); } catch (e) { automaticIssue = e instanceof Error ? e.message : "Automatic allocation could not be verified."; }
    const override = s.claimed_amount !== undefined;
    const claimed = override ? sen(s.claimed_amount) : automatic ? sen(automatic.expected_amount) : null;
    if (override && (!text(s.override_reason) || s.override_reason.trim().length < 3)) fail("Explain why you changed this reimbursement amount.");
    if (claimed === null || claimed <= 0) fail(automaticIssue && !override ? "AI could not verify the allocation. Check the original, then confirm a reimbursement amount and reason." : "Enter a positive reimbursement amount with at most two decimal places.");
    if (!override && claimed > total) fail("Calculated reimbursement cannot exceed the recorded receipt total.");
    const issues = [...(automatic?.issues ?? raw.warnings)];
    if (automaticIssue) issues.push("Automatic allocation unavailable: " + automaticIssue);
    if (!raw.readable || raw.document_type !== "receipt" || raw.payment_status !== "paid") issues.push("Verify readability, document type and payment evidence against the original.");
    if (override) issues.push("Member manually confirmed the reimbursement amount. This is not an automatic or independent AI verification.");
    const originalTotal = sen(raw.total);
    if (override && originalTotal !== null && claimed > originalTotal)
      issues.push(`Member-confirmed reimbursement exceeds the AI-read receipt total by RM ${decimal(claimed - originalTotal)}. Pending Treasurer review; verify the original and correction reason.`);
    else if (override && claimed > total)
      issues.push(`Member-confirmed reimbursement exceeds the recorded receipt total by RM ${decimal(claimed - total)}. Pending Treasurer review; verify the original and correction reason.`);
    const totals = receiptItemTotals(s.items);
    return { receipt_total: decimal(total), raw_receipt_total: raw.total, selected_subtotal: automatic?.selected_subtotal ?? (totals ? decimal(totals.selected) : null),
      excluded_subtotal: automatic?.excluded_subtotal ?? (totals ? decimal(totals.excluded) : "0.00"), tax: automatic?.tax ?? null, discount: automatic?.discount ?? null, rounding: automatic?.rounding ?? null,
      expected_amount: decimal(claimed), method: "simple", automatic_amount: automatic?.expected_amount ?? null, automatic_issue: automaticIssue,
      adjustment_reason: automatic?.adjustment_reason ?? "Allocation could not be established from the original reading; verify manually.",
      correction_reason: [s.correction_reason.trim(), override ? "Reimbursement correction: " + s.override_reason!.trim() : ""].filter(Boolean).join("\n"), issues };
  }
  if (s.mode === "full") {
    const total = sen(s.receipt_total), original = sen(raw.total);
    if (s.confirmed !== true || total === null || total <= 0 || !text(s.correction_reason) || !text(s.adjustment_reason) || !Array.isArray(s.items) || s.items.length !== raw.items.length || s.tax !== "" || s.discount !== "" || s.rounding !== "") fail("Confirm the final paid receipt total and that all purchases are for this activity.");
    const ids = new Set<string>();
    for (const row of s.items) {
      const item = raw.items.find(i => i.id === row?.id);
      if (!item || ids.has(row.id) || row.included !== true || row.amount !== (item.amount ?? "") || !text(row.reason)) fail("Full receipt mode must include every original item unchanged.");
      ids.add(row.id);
      if (requireItemReasons && row.reason.trim().length < 3) fail(`Enter the activity purpose for “${item.description}” (at least 3 characters).`);
    }
    if (original !== null && original !== total && s.correction_reason.trim().length < 3) fail("Explain why your final total differs from the AI reading.");
    const issues = [...raw.warnings];
    if (original === null || original !== total) issues.push("Member-confirmed total differs from or is missing in the AI reading. Verify the original.");
    if (!raw.readable || raw.document_type !== "receipt" || raw.payment_status !== "paid") issues.push("Verify document readability, type and payment evidence.");
    if (raw.items.some(i => i.relevance === "needs_confirmation")) issues.push("Member declared all purchases for the activity; review flagged item purposes.");
    return { receipt_total: decimal(total), raw_receipt_total: raw.total, selected_subtotal: null, excluded_subtotal: "0.00", tax: null, discount: null, rounding: null, expected_amount: decimal(total), method: "full", adjustment_reason: "Whole receipt; final paid total includes charges and discounts. Not independent AI verification.", correction_reason: s.correction_reason.trim(), issues };
  }
  if (s.confirmed !== true || !Array.isArray(s.items) || s.items.length !== raw.items.length || !s.items.length ||
    !["auto", "proportional", "manual"].includes(s.mode) || (s.mode !== "auto" && (sen(s.tax) === null || sen(s.discount) === null || sen(s.rounding, true) === null)) ||
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
    if (requireItemReasons && item.reason.trim().length < 3) fail(item.included ? `Enter the activity purpose for “${original.description}” (at least 3 characters).` : `Explain why “${original.description}” is excluded (at least 3 characters).`);
    if (sen(original.amount) !== n) corrected = true;
    if (item.included) selected += n; else excluded += n;
  }
  if (!selected) fail("Select at least one item with a positive amount.");
  if (corrected && s.correction_reason.trim().length < 3) fail("Explain any correction to the AI amounts or receipt total.");
  let tax = 0, discount = 0, rounding = 0, taxPolicy = "";
  const all = selected + excluded;
  if (s.mode === "auto") {
    const t = s.adjustment_treatment;
    if (!t || !validTreatment(t)) fail("Check the receipt adjustment settings.");
    const base = receiptTreatment(raw);
    let changed = false;
    const extra = (key: "tax" | "discount" | "rounding") => {
      if (t[key] === "unknown") fail(`Check whether ${key} is included, additional or absent. An unexplained difference is not automatically tax.`);
      if (t[key] !== base[key] || (t[key] === "additional" && sen(s[key], key === "rounding") !== sen(raw[key], key === "rounding"))) changed = true;
      if (t[key] !== "additional") return 0;
      const n = sen(s[key], key === "rounding");
      if (n === null) fail(`Enter the full receipt's ${key} amount from the original.`);
      return n;
    };
    const fullTax = extra("tax"), fullDiscount = extra("discount"), fullRounding = extra("rounding");
    if (changed && s.correction_reason.trim().length < 3) fail("Explain the adjustment settings you confirmed or corrected from the original.");
    if (all + fullTax - fullDiscount + fullRounding !== total) fail(`Items and adjustments total RM ${decimal(all + fullTax - fullDiscount + fullRounding)}, but the final receipt is RM ${decimal(total)}. Check the original; do not assume the difference is tax.`);
    if (excluded > 0 && fullTax) {
      // Uniformity can be unknown on otherwise reconciled receipts. Default only
      // receipt-level tax to all items; explicit mixed tax evidence still wins.
      if (base.tax_scope === "mixed" || t.tax_scope === "mixed") fail("The receipt shows mixed tax rates or tax-exempt items. Confirm a reimbursement amount and reason from the original.");
      taxPolicy = " Receipt-level tax is allocated across all items in proportion to their amounts by default.";
    }
    if (excluded > 0 && (fullDiscount || fullRounding) && !t.uniform) fail("Confirm discounts and rounding apply uniformly, or manually confirm a reimbursement amount and reason.");
    tax = share(fullTax, selected, all); discount = share(fullDiscount, selected, all); rounding = share(fullRounding, selected, all);
    if (changed) issues.push("Member confirmed or corrected adjustment treatment; verify the original.");
  } else if (s.mode === "proportional") {
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
    method: s.mode, adjustment_reason: s.mode === "auto" ? `Automatic proportional allocation: ${decimal(selected)} / ${decimal(all)}. Treatment: ${JSON.stringify(s.adjustment_treatment)}. Included adjustments are not added again.${taxPolicy}` : s.adjustment_reason.trim(), correction_reason: s.correction_reason.trim(), issues: [...new Set(issues)] };
}
