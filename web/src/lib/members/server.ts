import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const memberJson = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
});
export const memberId = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function memberAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Member invitations are not configured. Set the server's Supabase service role key.");
  // Implicit email links work on a different browser/device from the President's.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" } });
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
export async function memberSession() {
  const client = await createServerSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  return { client, user: error ? null : user };
}
