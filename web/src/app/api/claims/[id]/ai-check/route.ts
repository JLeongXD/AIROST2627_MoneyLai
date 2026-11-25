import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkSignature, compareClaim } from "@/lib/ai/claim-check";
import { readReceipts } from "@/lib/ai/gemini";
import { readReceiptDraft } from "@/lib/ai/receipt-reader";
import { calculateAllocation, type ReceiptPlan } from "@/lib/ai/receipt-allocation";
import type { Attachment, Claim } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 120;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return json({ error: "Invalid claim." }, 400);
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  if (request.headers.get("x-moneylai-ai-consent") !== "yes")
    return json({ error: "Confirm sharing receipts with Gemini first." }, 400);
  let runId: string | null = null;
  let admin: SupabaseClient | null = null;
  try {
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError || !user)
      return json({ error: "Please sign in again." }, 401);
    // Read everything using the caller's RLS-enforced client, not the privileged client.
    const { data: claim, error: claimError } = await client
      .from("claims")
      .select("*")
      .eq("id", id)
      .single();
    if (claimError || !claim)
      return json({ error: "Claim not found or access denied." }, 403);
    if (!["draft", "submitted", "needs_info", "rejected"].includes(claim.status))
      return json({ error: "AI checks are available before approval." }, 409);
    const { data: files, error: fileError } = await client
      .from("attachments")
      .select("*")
      .eq("claim_id", id)
      .order("id");
    if (fileError) return json({ error: "Unable to load receipt files." }, 500);
    const attachments = (files ?? []) as Attachment[];
    const receipts = attachments.filter((f) => f.kind === "receipt");
    if (!receipts.length)
      return json({ error: "Upload at least one receipt first." }, 400);
    if (
      receipts.length > 5 ||
      receipts.some(
        (f) =>
          !["image/jpeg", "image/png", "application/pdf"].includes(
            f.mime_type,
          ) || f.size_bytes > 5 * 1024 * 1024,
      ) ||
      receipts.reduce((n, f) => n + Number(f.size_bytes), 0) > 10 * 1024 * 1024
    )
      return json(
        {
          error:
            "AI checks support up to 5 receipts, 5 MB each and 10 MB total. Use smaller receipt files.",
        },
        400,
      );
    const key = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !model || !secret)
      return json(
        {
          error:
            "AI Claim Check is not configured. Ask your administrator to enable it.",
        },
        503,
      );
    if (!/^[a-zA-Z0-9._-]+$/.test(model))
      return json({ error: "Invalid AI model configuration." }, 503);
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const planResult = await client.from("claim_receipt_plans").select("*").eq("claim_id", id).maybeSingle();
    if (planResult.error && !["42P01", "PGRST205"].includes(planResult.error.code)) throw new Error("Unable to load receipt item selections.");
    const receiptPlan = planResult.data as ReceiptPlan | null;
    const signature = checkSignature(claim as Claim, attachments, receiptPlan?.revision);
    const { data: reserved, error: reserveError } = await admin.rpc(
      "ml_begin_ai_check",
      { p_user: user.id, p_claim: id, p_signature: signature, p_model: model },
    );
    if (reserveError)
      return json(
        {
          error:
            /already running|30 seconds|limit reached|before approval/.test(
              reserveError.message,
            )
              ? reserveError.message
              : "Unable to start the check. Confirm AI database setup and claim access.",
        },
        409,
      );
    runId = reserved as string;
    const inputs = [];
    let total = 0;
    for (const f of receipts) {
      const { data: blob, error } = await client.storage
        .from("receipts")
        .download(f.storage_path);
      if (error || !blob)
        throw new Error(
          "Unable to read a receipt. Refresh the claim and try again.",
        );
      total += blob.size;
      if (blob.size > 5 * 1024 * 1024 || total > 10 * 1024 * 1024)
        throw new Error("Receipt files exceed the AI size limit.");
      const bytes = Buffer.from(await blob.arrayBuffer());
      const valid =
        f.mime_type === "application/pdf"
          ? bytes.subarray(0, 5).toString() === "%PDF-"
          : f.mime_type === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!valid)
        throw new Error(
          "A receipt does not match its file type. Upload a valid JPG, PNG or PDF.",
        );
      inputs.push({ id: f.id, mime: f.mime_type, bytes });
    }
    const { data: activity, error: activityError } = await client.from("activities").select("name,description").eq("id", claim.activity_id).single();
    if (activityError) throw new Error("Unable to read activity context.");
    const sameSource = receiptPlan && inputs.length === 1 && inputs[0].id === receiptPlan.attachment_id &&
      createHash("sha256").update(inputs[0].bytes).digest("hex") === receiptPlan.sha256;
    let validPlan: ReceiptPlan | null = null;
    let extracted;
    if (sameSource && receiptPlan) {
      const fresh = await readReceiptDraft(key, model, { mime: inputs[0].mime, bytes: inputs[0].bytes }, activity!, { description: claim.description, category: claim.category });
      const warnings = [...fresh.warnings];
      const facts = (items: typeof fresh.items) => JSON.stringify(items.map(i => [i.description.trim().toLowerCase(), i.amount === null ? null : Number(i.amount)]));
      if (facts(fresh.items) !== facts(receiptPlan.extraction.items)) warnings.push("Fresh AI item readings differ from the saved extraction. Check the original receipt and correction notes; this alone is not evidence of misuse.");
      if (fresh.document_type !== "receipt" || fresh.payment_status !== "paid") warnings.push(`Document: ${fresh.document_type}; payment: ${fresh.payment_status}. Verify payment evidence.`);
      validPlan = { ...receiptPlan, calculation: calculateAllocation(receiptPlan.extraction, receiptPlan.selection) };
      extracted = { receipts: [{ attachment_id: inputs[0].id, readable: fresh.readable, merchant: fresh.merchant, amount: fresh.total,
        currency: fresh.currency, date: fresh.date, receipt_number: fresh.receipt_number, note: "Fresh reading of the original for item-based review." }],
        purpose_clear: fresh.purpose_clear, purpose_note: fresh.purpose_note, warnings };
    } else {
      extracted = await readReceipts(
      key,
      model,
      claim.description,
      claim.category,
      inputs,
      activity ?? undefined,
    );
      if (receiptPlan) extracted.warnings.push("Saved item selection no longer matches the receipt attachments. This check uses full receipt totals; revise the draft before relying on the previous allocation.");
    }
    const { error: indexError } = await admin.from("receipt_fingerprints").upsert(inputs.map((input) => {
      const reading = extracted.receipts.find((r) => r.attachment_id === input.id)!;
      return { attachment_id: input.id, sha256: createHash("sha256").update(input.bytes).digest("hex"),
        merchant: reading.readable ? reading.merchant : null, amount: reading.readable ? reading.amount : null,
        currency: reading.readable ? reading.currency : null, purchase_date: reading.readable ? reading.date : null,
        receipt_number: reading.readable ? reading.receipt_number ?? null : null };
    }), { onConflict: "attachment_id" });
    if (indexError) throw new Error("Unable to save receipt comparison data. Check database setup.");
    const result = compareClaim(
      extracted,
      Number(claim.amount).toFixed(2),
      claim.purchase_date,
      validPlan,
    );
    // Store the ORIGINAL input signature. If the claim changed during inference,
    // the client will label these results Outdated instead of silently trusting them.
    const { error: saveError } = await admin
      .from("ai_claim_checks")
      .update({
        status: "complete",
        result,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("status", "running");
    if (saveError)
      throw new Error(
        "The AI result could not be saved. Refresh and try again later.",
      );
    return json({ ok: true });
  } catch (error) {
    if (admin && runId)
      await admin
        .from("ai_claim_checks")
        .update({ status: "failed", finished_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("status", "running");
    if (error instanceof Error && error.name === "ReceiptAiError" && "httpStatus" in error && typeof error.httpStatus === "number" && [422, 429, 502, 503, 504].includes(error.httpStatus)) {
      if ("diagnostic" in error) console.error("[MoneyLai receipt AI cross-check]", error.diagnostic);
      return json({ error: error.message }, error.httpStatus);
    }
    return json(
      {
        error:
          error instanceof Error &&
          !/supabase|key|secret|token/i.test(error.message)
            ? error.message
            : "AI check failed. Please try again later.",
      },
      502,
    );
  }
}
