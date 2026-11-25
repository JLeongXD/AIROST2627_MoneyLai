export type Role = "member" | "treasurer" | "president";
export type ClaimStatus =
  "draft" | "submitted" | "needs_info" | "approved" | "rejected" | "paid" | "cancelled";
export type Money = number | string;
export type Profile = { id: string; display_name: string; role: Role };
export type Payout = {
  user_id: string;
  recipient_name: string;
  provider_name: string;
  account_number: string;
};
export type Activity = {
  id: string;
  name: string;
  description: string | null;
  budget: Money;
  event_date: string | null;
  status: "active" | "closed";
  approved_spend: Money;
  pending_amount: Money;
  paid_amount: Money;
  remaining_budget: Money;
  unpaid_amount: Money;
};
export type Claim = {
  id: string;
  claim_number?: number | string;
  claimant_id: string;
  activity_id: string;
  amount: Money;
  description: string;
  purchase_date: string | null;
  category: string;
  status: ClaimStatus;
  rejection_reason: string | null;
  info_requested_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  activity: { name: string } | null;
  claimant: { display_name: string } | null;
};
export type Attachment = {
  id: string;
  claim_id: string;
  kind: "receipt" | "supporting";
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};
export type Payment = {
  id: string;
  claim_id: string;
  paid_on: string;
  reference: string;
  proof_path: string;
  amount: Money;
  recipient_snapshot: Omit<Payout, "user_id">;
  created_at: string;
};
export type ClaimEvent = {
  id: string;
  event_type: string;
  note: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
  actor: { display_name: string } | null;
};
export type ActivityEvent = {
  id: string;
  old_budget: Money | null;
  new_budget: Money;
  note: string;
  created_at: string;
};

export type PresidentClaim = {
  id: string;
  claimant_name: string;
  activity_id: string;
  activity_name: string;
  amount: Money;
  description: string;
  status: ClaimStatus;
  submitted_at: string | null;
};
export type PresidentSnapshot = {
  activities: Activity[];
  claims: PresidentClaim[];
  claim_count: number;
};

export type BudgetRequest = {
  id: string;
  activity_id: string | null;
  name: string;
  description: string | null;
  event_date: string | null;
  base_budget: Money | null;
  proposed_budget: Money;
  reason: string;
  requested_by: string;
  requester_name: string;
  reviewer_name: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};
