import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = (error: string, status: number) => Response.json({ error }, { status });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json("Invalid claim.", 400);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json("Invalid origin.", 403);
  try {
    const client = await createServerSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json("Please sign in again.", 401);
    const { data: claim, error } = await client.from("claims").select("id").eq("id", id).single();
    if (error || !claim) return json("Claim access denied.", 403);
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) return json("Receipt indexing is not configured.", 503);
    const { data: files, error: fileError } = await client.from("attachments").select("id,storage_path").eq("claim_id", id).eq("kind", "receipt").limit(5);
    if (fileError) return json("Unable to read receipt records.", 500);
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const ids = (files ?? []).map((file) => file.id);
    const { data: indexed, error: indexError } = ids.length ? await admin.from("receipt_fingerprints").select("attachment_id").in("attachment_id", ids) : { data: [], error: null };
    if (indexError) return json("Indexing is unavailable. Check database setup.", 503);
    const known = new Set((indexed ?? []).map((row) => row.attachment_id));
    const rows = [];
    for (const file of files ?? []) {
      if (known.has(file.id)) continue;
      const { data: blob, error: downloadError } = await client.storage.from("receipts").download(file.storage_path);
      if (downloadError || !blob || blob.size > 5 * 1024 * 1024) return json("Unable to index receipt files.", 409);
      rows.push({ attachment_id: file.id, sha256: createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex") });
    }
    if (rows.length) {
      const { error: saveError } = await admin.from("receipt_fingerprints").upsert(rows, { onConflict: "attachment_id" });
      if (saveError) return json("Indexing failed. Check database setup and retry.", 503);
    }
    return Response.json({ ok: true });
  } catch {
    return json("Receipt indexing failed. Please retry.", 500);
  }
}
