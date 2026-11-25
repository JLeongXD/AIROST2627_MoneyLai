import { createClient } from "./supabase/client";
import { fileError } from "./domain";
import type {
  Activity,
  ActivityEvent,
  Attachment,
  Claim,
  ClaimEvent,
  Payment,
  Payout,
  Profile,
} from "./types";
export async function rpc<T = void>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await createClient().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function getProfile(id: string) {
  const { data, error } = await createClient()
    .from("profiles")
    .select("id,display_name,role")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Profile;
}
export async function listActivities() {
  return rpc<Activity[]>("ml_activity_summary");
}
const claimSelect =
  "*,activity:activities(name),claimant:profiles!claims_claimant_profile_fkey(display_name)";
export async function listClaims(userId?: string) {
  let query = createClient()
    .from("claims")
    .select(claimSelect)
    .order("created_at", { ascending: false })
    .limit(500);
  if (userId) query = query.eq("claimant_id", userId);
  const { data, error } = await query.overrideTypes<
    Claim[],
    { merge: false }
  >();
  if (error) throw error;
  return data ?? [];
}
export async function getClaim(id: string) {
  const { data, error } = await createClient()
    .from("claims")
    .select(claimSelect)
    .eq("id", id)
    .limit(1)
    .overrideTypes<Claim[], { merge: false }>();
  if (error) throw error;
  if (!data?.[0]) throw new Error("Claim not found or you do not have access.");
  return data[0];
}
export async function getAttachments(id: string) {
  const { data, error } = await createClient()
    .from("attachments")
    .select("*")
    .eq("claim_id", id)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Attachment[];
}
export async function getEvents(id: string) {
  const { data, error } = await createClient()
    .from("claim_events")
    .select("*,actor:profiles(display_name)")
    .eq("claim_id", id)
    .order("created_at", { ascending: false })
    .overrideTypes<ClaimEvent[], { merge: false }>();
  if (error) throw error;
  return data ?? [];
}
export async function getPayment(id: string) {
  const { data, error } = await createClient()
    .from("payments")
    .select("*")
    .eq("claim_id", id)
    .maybeSingle();
  if (error) throw error;
  return data as Payment | null;
}
export async function getPayout(userId: string) {
  const { data, error } = await createClient()
    .from("payout_details")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Payout | null;
}
export async function getActivityEvents(id: string) {
  const { data, error } = await createClient()
    .from("activity_events")
    .select("*")
    .eq("activity_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ActivityEvent[];
}
export async function uploadFile(
  bucket: "receipts" | "payment-proofs",
  claimId: string,
  file: File,
) {
  const issue = fileError(file);
  if (issue) throw new Error(issue);
  const client = createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error("Please sign in again.");
  const ext =
    file.type === "application/pdf"
      ? "pdf"
      : file.type === "image/png"
        ? "png"
        : "jpg";
  const path = `${user.id}/${claimId}/${crypto.randomUUID()}.${ext}`;
  const result = await client.storage
    .from(bucket)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (result.error) throw result.error;
  return path;
}
export async function uploadAttachment(
  claimId: string,
  file: File,
  kind: "receipt" | "supporting",
) {
  if (file.name.length > 200)
    throw new Error("Rename the file to fewer than 200 characters.");
  const path = await uploadFile("receipts", claimId, file);
  try {
    await rpc("ml_register_attachment", {
      p_claim_id: claimId,
      p_path: path,
      p_name: file.name,
      p_kind: kind,
    });
  } catch (error) {
    const { data, error: checkError } = await createClient()
      .from("attachments")
      .select("id")
      .eq("storage_path", path);
    if (!checkError && data?.length === 0)
      await createClient().storage.from("receipts").remove([path]);
    throw error;
  }
  // Indexing is advisory; a temporary indexing failure must not lose an upload.
  if (kind === "receipt") {
    try {
      await fetch(`/api/claims/${claimId}/receipt-index`, { method: "POST", signal: AbortSignal.timeout(20000) });
    } catch { /* Treasurer can retry indexing from the duplicate review panel. */ }
  }
}
export async function removeAttachment(id: string) {
  const path = await rpc<string>("ml_remove_attachment", {
    p_attachment_id: id,
  });
  const { error } = await createClient()
    .storage.from("receipts")
    .remove([path]);
  if (error)
    throw new Error(
      "Attachment was unlinked, but file cleanup failed. Refresh the claim; contact the maintainer to clean unused files.",
    );
}
export async function signedFile(bucket: string, path: string) {
  const { data, error } = await createClient()
    .storage.from(bucket)
    .createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}

export async function getPresidentOverview() {
  return rpc<import("./types").PresidentSnapshot>("ml_president_overview");
}

export async function listBudgetRequests() {
  return rpc<import("./types").BudgetRequest[]>("ml_list_budget_requests");
}
