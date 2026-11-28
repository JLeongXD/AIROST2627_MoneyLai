import type { Attachment, Claim } from "./types";
import type { ReceiptAssistantValue, ReceiptPlan } from "./ai/receipt-allocation";
export type DraftProgress = { id: string | null; uploadedFile: File | null; revision: number };
export type DraftFields = { activityId: string; amount: string; description: string; purchaseDate: string; category: string };
type DraftServices = {
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>; fetch: typeof fetch;
  upload: (id: string, file: File, kind: "receipt") => Promise<void>;
  claim: (id: string) => Promise<Claim>; attachments: (id: string) => Promise<Attachment[]>; plan: (id: string) => Promise<ReceiptPlan | null>;
};
// Reuse acknowledged draft and upload progress across retries.
export async function saveClaimDraft(fields: DraftFields, file: File | null, assisted: ReceiptAssistantValue | null, progress: DraftProgress, services: DraftServices) {
  if (assisted) {
    const response = await services.fetch(`/api/receipt-drafts/${assisted.sessionId}/save`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ claimId: progress.id, revision: progress.revision, selection: assisted.selection,
        fields: { amount: fields.amount.trim(), description: fields.description.trim(), purchase_date: fields.purchaseDate, category: fields.category } }),
    });
    const result = await response.json();
    if (result.claimId) progress.id = result.claimId;
    if (!response.ok) throw new Error(result.error || "Could not save this draft. Your saved progress is retained.");
    if (!progress.id) throw new Error("Draft could not be found. Try again.");
    progress.revision += 1;
    progress.uploadedFile = file;
  } else {
    progress.id = await services.rpc<string>("ml_save_claim", { p_claim_id: progress.id, p_activity_id: fields.activityId, p_amount: fields.amount.trim(), p_description: fields.description.trim(), p_purchase_date: fields.purchaseDate, p_category: fields.category });
    if (file && progress.uploadedFile !== file) {
      await services.upload(progress.id, file, "receipt"); progress.uploadedFile = file;
    }
  }
  const [claim, attachments, plan] = await Promise.all([services.claim(progress.id), services.attachments(progress.id), services.plan(progress.id)]);
  progress.revision = plan?.revision ?? 0;
  return { claim, attachments, plan };
}
