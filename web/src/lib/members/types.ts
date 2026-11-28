import type { Role } from "@/lib/types";
export type Member = {
  id: string; display_name: string; email: string; role: Role;
  account_status: "active" | "invited" | "disabled";
};
export type Invitation = {
  id: string; email: string; display_name: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  delivery_status: "sending" | "sent" | "failed";
  sent_at: string | null; expires_at: string; created_at: string;
};
export type ManagementEvent = {
  id: string; created_at: string; event_type: string; actor: string;
  target: string | null; reason: string; details: Record<string, string>;
};
export type MemberDirectory = { members: Member[]; invitations: Invitation[]; events: ManagementEvent[] };
export type MembershipApplication = { user_id: string; email: string; display_name: string; status: "pending" | "approved" | "rejected"; created_at: string; reason: string | null };
export type Handover = {
  id: string; from_id: string; to_id: string; from_name: string; to_name: string; reason: string; expires_at: string;
};
export async function sendInvitation(body: { name: string; email: string } | { invitationId: string }) {
  const response = await fetch("/api/members/invitations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Invitation could not be sent.");
  return result as { message: string };
}
