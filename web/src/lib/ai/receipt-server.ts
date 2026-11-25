import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
export const receiptJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export const validReceiptId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function receiptAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Receipt assistance is not configured. Use manual entry or ask the administrator to enable it.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function verifyReceiptBytes(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > 5 * 1024 ** 2) throw new Error("Receipt files must be between 1 byte and 5 MB.");
  const valid = mime === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw new Error("Receipt contents do not match the JPG, PNG or PDF file type.");
  return createHash("sha256").update(bytes).digest("hex");
}
