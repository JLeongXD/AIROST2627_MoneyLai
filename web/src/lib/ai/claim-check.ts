import type { Attachment, Claim } from "../types";
import type { ReceiptPlan } from "./receipt-allocation";

export type ReceiptReading = {
  attachment_id: string;
  readable: boolean;
  merchant: string | null;
  amount: string | null;
  currency: string | null;
  date: string | null;
  note: string;
  receipt_number?: string | null;
};
export type Extraction = {
  receipts: ReceiptReading[];
  purpose_clear: boolean;
  purpose_note: string;
  warnings: string[];
};
export type CheckResult = Extraction & {
  amount_status: "match" | "mismatch" | "unable_to_verify";
  date_status: "match" | "mismatch" | "unable_to_verify";
  receipt_total: string | null;
  needs_attention: boolean;
  allocation?: { expected_amount: string; claimed_amount: string; difference: string; receipt_total: string; revision: number };
};
export type SavedCheck = {
  id: string;
  status: "running" | "complete" | "failed";
  input_signature: string;
  result: CheckResult | null;
  model: string;
  created_at: string;
};

// Content-based signature is shared by client and server. Status/updated_at changes
// do not invalidate results; changes to claim inputs or ANY attachment do.
export function checkSignature(
  c: Pick<
    Claim,
    "amount" | "purchase_date" | "category" | "description" | "activity_id"
  >,
  files: Attachment[],
  receiptPlanRevision?: number,
) {
  const inputs: unknown[] = [
    String(Number(c.amount).toFixed(2)),
    c.purchase_date,
    c.category,
    c.description,
    c.activity_id,
    [...files]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((a) => [
        a.id,
        a.kind,
        a.storage_path,
        a.size_bytes,
        a.mime_type,
        a.created_at,
      ]),
  ];
  if (receiptPlanRevision !== undefined) inputs.push(["receipt_plan_revision", receiptPlanRevision]);
  return JSON.stringify(inputs);
}
export function cents(value: string): number | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function validateExtraction(
  value: unknown,
  expectedIds: string[],
): Extraction {
  if (!value || typeof value !== "object")
    throw new Error("AI returned an invalid result. Please try again.");
  const v = value as Record<string, unknown>;
  const text = (x: unknown, max = 1000): x is string =>
    typeof x === "string" && x.length <= max;
  if (
    !Array.isArray(v.receipts) ||
    v.receipts.length !== expectedIds.length ||
    typeof v.purpose_clear !== "boolean" ||
    !text(v.purpose_note) ||
    !Array.isArray(v.warnings) ||
    v.warnings.length > 10 ||
    !v.warnings.every((x) => text(x))
  )
    throw new Error("AI returned incomplete findings. Please try again.");
  const seen = new Set<string>();
  for (const raw of v.receipts) {
    if (!raw || typeof raw !== "object")
      throw new Error("Invalid receipt reading.");
    const r = raw as ReceiptReading;
    if (
      !expectedIds.includes(r.attachment_id) ||
      seen.has(r.attachment_id) ||
      typeof r.readable !== "boolean" ||
      !text(r.note) ||
      !(r.receipt_number === undefined || r.receipt_number === null || text(r.receipt_number, 200)) ||
      !(r.merchant === null || text(r.merchant, 200)) ||
      !(
        r.amount === null ||
        (text(r.amount, 20) && cents(r.amount) !== null)
      ) ||
      !(
        r.currency === null ||
        (text(r.currency, 3) && /^[A-Z]{3}$/.test(r.currency))
      ) ||
      !(r.date === null || (text(r.date, 10) && validDate(r.date)))
    )
      throw new Error("AI returned invalid receipt fields. Please try again.");
    seen.add(r.attachment_id);
  }
  return v as unknown as Extraction;
}
export function compareClaim(
  extracted: Extraction,
  amount: string,
  date: string | null,
  plan?: ReceiptPlan | null,
): CheckResult {
  const rs = extracted.receipts;
  const allAmounts =
    rs.length > 0 &&
    rs.every(
      (r) =>
        r.readable &&
        r.amount !== null &&
        r.currency === "MYR" &&
        cents(r.amount) !== null,
    );
  const sum = allAmounts ? rs.reduce((n, r) => n + cents(r.amount!)!, 0) : null;
  const expected = plan ? cents(plan.calculation.expected_amount) : sum;
  const warnings = [...extracted.warnings, ...(plan?.calculation.issues ?? [])];
  if (plan && sum !== cents(plan.extraction.total ?? "")) warnings.push("Fresh AI reading differs from the saved original total. Compare the original and any user corrections before deciding.");
  const amount_status =
    sum === null
      ? "unable_to_verify"
      : expected === null ? "unable_to_verify" : expected === cents(amount)
        ? "match"
        : "mismatch";
  const allDates =
    !!date && rs.length > 0 && rs.every((r) => r.readable && r.date !== null);
  const date_status = !allDates
    ? "unable_to_verify"
    : rs.every((r) => r.date === date)
      ? "match"
      : "mismatch";
  return {
    ...extracted,
    warnings: [...new Set(warnings)],
    amount_status,
    date_status,
    receipt_total: sum === null ? null : (sum / 100).toFixed(2),
    needs_attention:
      amount_status !== "match" ||
      date_status !== "match" ||
      !extracted.purpose_clear ||
      warnings.length > 0,
    ...(plan && expected !== null ? { allocation: { expected_amount: plan.calculation.expected_amount, claimed_amount: amount,
      difference: ((cents(amount)! - expected) / 100).toFixed(2), receipt_total: plan.calculation.receipt_total, revision: plan.revision } } : {}),
  };
}
