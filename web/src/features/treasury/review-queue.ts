import type { Claim } from "@/lib/types";

export const queueLabels = { submitted: "To review", approved: "To pay", needs_info: "Waiting", history: "History" };
export type QueueKey = keyof typeof queueLabels;
export function queueKey(value: string | null): QueueKey {
  return value && Object.hasOwn(queueLabels, value) ? value as QueueKey : "submitted";
}
export function queueClaims(claims: Claim[], queue: QueueKey, search = "", activity = "") {
  const term = search.trim().toLowerCase();
  return claims.filter(c => {
    const waiting = c.status === "needs_info" || (c.status === "draft" && Boolean(c.info_requested_at));
    const matches = queue === "history" ? ["paid", "rejected", "cancelled"].includes(c.status)
      : queue === "needs_info" ? waiting : c.status === queue;
    return matches && (!activity || c.activity_id === activity) &&
      `${c.claimant?.display_name ?? ""} ${c.activity?.name ?? ""} ${c.description}`.toLowerCase().includes(term);
  }).sort((a, b) => queue === "history"
    ? b.updated_at.localeCompare(a.updated_at)
    : (a.submitted_at ?? a.created_at).localeCompare(b.submitted_at ?? b.created_at));
}
export function treasuryQuery(queue: QueueKey, search = "", activity = "") {
  const params = new URLSearchParams({ queue });
  if (search) params.set("search", search);
  if (activity) params.set("activity", activity);
  return `?${params}`;
}
