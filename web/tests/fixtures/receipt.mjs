export const reading = {
  readable: true, merchant: "Workshop Shop", receipt_number: "R-100", date: "2026-11-20", currency: "MYR",
  total: "100.00", tax: "0.00", discount: "0.00", rounding: "0.00", line_amount_basis: "gross",
  document_type: "receipt", payment_status: "paid", purpose_clear: true, purpose_note: "Workshop supplies",
  suggested_category: "Materials", suggested_description: "Materials and drinks for the robotics workshop", warnings: [],
  items: [
    { id: "1", description: "活动饮用水 / Water", quantity: "10", amount: "30.00", relevance: "likely_activity", reason: "" },
    { id: "2", description: "Workshop components", quantity: "1", amount: "50.00", relevance: "likely_activity", reason: "" },
    { id: "3", description: "Other purchase", quantity: "1", amount: "20.00", relevance: "needs_confirmation", reason: "Explain how this item was used for the activity." },
  ],
};
export const selection = { items: [
  { id: "1", included: true, amount: "30.00", reason: "Workshop drinks" },
  { id: "2", included: true, amount: "50.00", reason: "" },
  { id: "3", included: false, amount: "20.00", reason: "Personal purchase" },
], receipt_total: "100.00", mode: "manual", tax: "0.00", discount: "0.00", rounding: "0.00", adjustment_reason: "Tax is already in the line prices.", correction_reason: "", confirmed: true };
