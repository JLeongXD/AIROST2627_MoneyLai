import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readReceiptDraft } from "@/lib/ai/receipt-reader";
import { receiptAdmin, receiptJson as json, validReceiptId, verifyReceiptBytes } from "@/lib/ai/receipt-server";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid origin." }, 403);
  if (request.headers.get("x-moneylai-ai-consent") !== "yes") return json({ error: "Confirm sharing this receipt with Gemini first." }, 400);
  const { id } = await params;
  if (!validReceiptId(id)) return json({ error: "Invalid receipt draft." }, 400);
  let failure: (() => Promise<unknown>) | undefined;
  try {
    const client = await createServerSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Please sign in again." }, 401);
    const { data: session, error } = await client.from("receipt_drafts").select("*").eq("id", id).eq("user_id", user.id).single();
    if (error || !session || (session.claim_id === null && Date.parse(session.expires_at) <= Date.now())) return json({ error: "Receipt draft unavailable or expired. Upload it again, or use manual entry. Confirm migration 013 has been applied." }, 409);
    if (session.status === "complete") {
      const duplicate = await client.rpc("ml_receipt_draft_duplicates", { p_session: id });
      if (duplicate.error) throw new Error("Receipt was read, but duplicate lookup is unavailable. Please retry.");
      return json({ extraction: session.extraction, duplicates: duplicate.data });
    }
    const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
    if (!key || !model || !/^[a-zA-Z0-9._-]+$/.test(model)) return json({ error: "AI receipt reading is not configured. Manual entry is available." }, 503);
    const admin = receiptAdmin();
    // Clean abandoned temporary uploads on this user's next extraction. Bound claims are retained.
    const expired = await admin.from("receipt_drafts").select("id,storage_path").eq("user_id", user.id).is("claim_id", null).lt("expires_at", new Date().toISOString()).limit(30);
    if (expired.data?.length) {
      const removed = await admin.storage.from("receipt-drafts").remove(expired.data.map(s => s.storage_path));
      if (!removed.error) await admin.from("receipt_drafts").delete().in("id", expired.data.map(s => s.id));
    }
    const begin = await admin.rpc("ml_begin_receipt_read", { p_user: user.id, p_session: id, p_model: model });
    if (begin.error) return json({ error: begin.error.message }, 409);
    const runId = begin.data;
    failure = async () => {
      await admin.from("receipt_drafts").update({ status: "failed" }).eq("id", id).eq("run_id", runId);
      await admin.from("ai_claim_checks").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", runId);
    };
    const file = await client.storage.from("receipt-drafts").download(session.storage_path);
    if (file.error || !file.data) throw new Error("Receipt upload could not be read. Upload it again or use manual entry.");
    const bytes = Buffer.from(await file.data.arrayBuffer()), sha256 = verifyReceiptBytes(bytes, session.mime_type);
    const activity = await client.from("activities").select("name,description").eq("id", session.activity_id).single();
    if (activity.error) throw new Error("Unable to load this activity.");
    const extraction = await readReceiptDraft(key, model, { mime: session.mime_type, bytes }, activity.data);
    const saved = await admin.from("receipt_drafts").update({ status: "complete", extraction, sha256 }).eq("id", id).eq("run_id", runId).select("id").single();
    if (saved.error) throw new Error("The receipt reading could not be saved. Please retry.");
    await admin.from("ai_claim_checks").update({ status: "complete", finished_at: new Date().toISOString() }).eq("id", runId);
    failure = undefined;
    const duplicates = await client.rpc("ml_receipt_draft_duplicates", { p_session: id });
    if (duplicates.error) throw new Error("Receipt was read, but duplicate lookup failed. Retry to retrieve the saved reading.");
    return json({ extraction, duplicates: duplicates.data });
  } catch (e) {
    if (failure) await failure();
    if (e instanceof Error && e.name === "ReceiptAiError" && "httpStatus" in e && typeof e.httpStatus === "number" && [422, 429, 502, 503, 504].includes(e.httpStatus)) {
      if ("diagnostic" in e) console.error("[MoneyLai receipt AI]", e.diagnostic);
      return json({ error: e.message }, e.httpStatus);
    }
    return json({ error: e instanceof Error ? e.message : "Receipt reading failed. Manual entry is available." }, 500);
  }
}
