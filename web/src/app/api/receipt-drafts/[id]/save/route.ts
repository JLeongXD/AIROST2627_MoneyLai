import { createServerSupabaseClient } from "@/lib/supabase/server";
import { calculateAllocation, validateReceiptExtraction, type ReceiptSelection } from "@/lib/ai/receipt-allocation";
import { receiptAdmin, receiptJson as json, validReceiptId, verifyReceiptBytes } from "@/lib/ai/receipt-server";
import { amountError, CATEGORIES, today } from "@/lib/domain";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid origin." }, 403);
  const { id } = await params;
  if (!validReceiptId(id)) return json({ error: "Invalid receipt draft." }, 400);
  let claimId: string | undefined;
  try {
    const client = await createServerSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Please sign in again." }, 401);
    const bodyText = await request.text();
    if (bodyText.length > 200000) return json({ error: "Receipt selection is too large." }, 413);
    let body;
    try { body = JSON.parse(bodyText); } catch { return json({ error: "Invalid request data." }, 400); }
    const f = body?.fields;
    if (!f || typeof f.amount !== "string" || amountError(f.amount) || typeof f.description !== "string" || !f.description.trim() || f.description.length > 500 ||
      !CATEGORIES.includes(f.category) || typeof f.purchase_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.purchase_date) ||
      Number.isNaN(Date.parse(f.purchase_date)) || new Date(f.purchase_date).toISOString().slice(0, 10) !== f.purchase_date || f.purchase_date > today() ||
      !Number.isInteger(body.revision) || body.revision < 0 || (body.claimId !== null && !validReceiptId(body.claimId ?? ""))) return json({ error: "Enter a valid amount, date, category and description." }, 400);
    const fields = { amount: f.amount.trim(), description: f.description.trim(), category: f.category, purchase_date: f.purchase_date };
    const sessionResult = await client.from("receipt_drafts").select("*").eq("id", id).eq("user_id", user.id).single();
    const s = sessionResult.data;
    if (sessionResult.error || !s || s.status !== "complete") return json({ error: "A completed receipt reading is required." }, 409);
    // Neither extraction nor expected amount is accepted from the browser.
    const extraction = validateReceiptExtraction(s.extraction);
    let calculation;
    try { calculation = calculateAllocation(extraction, body.selection); } catch (e) { return json({ error: e instanceof Error ? e.message : "Invalid receipt selection." }, 400); }
    const chosen = body.selection as ReceiptSelection;
    const selection: ReceiptSelection = { items: chosen.items.map(i => ({ id: i.id, included: i.included, amount: i.amount, reason: i.reason })),
      receipt_total: chosen.receipt_total, mode: chosen.mode, tax: chosen.tax, discount: chosen.discount, rounding: chosen.rounding,
      adjustment_reason: chosen.adjustment_reason, correction_reason: chosen.correction_reason, confirmed: true };
    const admin = receiptAdmin();
    const prepared = await client.rpc("ml_prepare_receipt_claim", { p_session: id, p_claim_id: body.claimId,
      p_amount: fields.amount, p_description: fields.description, p_date: fields.purchase_date, p_category: fields.category, p_revision: body.revision });
    if (prepared.error) return json({ error: prepared.error.message, claimId: s.claim_id }, 409);
    claimId = prepared.data as string;
    const ext = s.mime_type === "application/pdf" ? "pdf" : s.mime_type === "image/png" ? "png" : "jpg";
    const path = `${user.id}/${claimId}/${id}.${ext}`;
    const existing = await client.from("attachments").select("id").eq("claim_id", claimId).eq("storage_path", path).maybeSingle();
    // On later edits the immutable original lives in receipts; initial saves use staging.
    const file = await client.storage.from(existing.data ? "receipts" : "receipt-drafts").download(existing.data ? path : s.storage_path);
    if (file.error || !file.data) throw new Error("Original receipt is unavailable. Your draft is retained; open it to recover or upload the receipt again.");
    const bytes = Buffer.from(await file.data.arrayBuffer());
    if (verifyReceiptBytes(bytes, s.mime_type) !== s.sha256) throw new Error("The receipt file changed after extraction. Upload and read it again.");
    if (!existing.data) {
      const upload = await client.storage.from("receipts").upload(path, bytes, { contentType: s.mime_type, upsert: false });
      if (upload.error) {
        // A previous interrupted save may already have copied the same immutable file.
        const previous = await admin.storage.from("receipts").download(path);
        if (previous.error || !previous.data || verifyReceiptBytes(Buffer.from(await previous.data.arrayBuffer()), s.mime_type) !== s.sha256) throw new Error("Could not copy the original receipt. Open the retained draft or retry saving.");
      }
    }
    const finished = await admin.rpc("ml_finish_receipt_claim", { p_user: user.id, p_session: id, p_selection: selection,
      p_calculation: calculation, p_fields: fields, p_revision: body.revision });
    if (finished.error) throw new Error(finished.error.message);
    // Bound session metadata remains for history; only its duplicate temporary bytes are removed.
    await admin.storage.from("receipt-drafts").remove([s.storage_path]);
    return json({ claimId, expectedAmount: calculation.expected_amount });
  } catch (e) { return json({ error: e instanceof Error ? e.message : "Could not save this assisted draft.", claimId }, 409); }
}
