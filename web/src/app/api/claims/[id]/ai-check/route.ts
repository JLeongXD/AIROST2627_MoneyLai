import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkSignature, compareClaim } from "@/lib/ai/claim-check";
import { readReceipts } from "@/lib/ai/gemini";
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
    if (!["draft", "submitted", "rejected"].includes(claim.status))
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
    const signature = checkSignature(claim as Claim, attachments);
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
    const extracted = await readReceipts(
      key,
      model,
      claim.description,
      claim.category,
      inputs,
    );
    const result = compareClaim(
      extracted,
      Number(claim.amount).toFixed(2),
      claim.purchase_date,
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
