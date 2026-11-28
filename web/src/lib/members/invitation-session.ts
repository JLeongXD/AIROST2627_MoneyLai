import type { SupabaseClient } from "@supabase/supabase-js";

export type VerifiedInvitation = { token: string; userId: string; email: string };
const invalidLink = "This invitation link is incomplete or expired. Ask the President to resend it and open the latest email link.";

export async function verifyInvitationSession(
  client: Pick<SupabaseClient, "auth">,
  href: string,
  scrub: (url: string) => void,
  request: typeof fetch = fetch,
): Promise<VerifiedInvitation> {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = url.searchParams.get("invitation") ?? "";
  const access = fragment.get("access_token");
  const refresh = fragment.get("refresh_token");
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  const failed = [fragment, url.searchParams].some(p => p.has("error") || p.has("error_code") || p.has("error_description"));
  // Remove authentication material before any asynchronous work or error display.
  url.hash = "";
  for (const key of ["code", "sb_flow_id", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  scrub(url.pathname + url.search);
  if (failed || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) throw new Error(invalidLink);

  if (access || refresh) {
    if (!access || !refresh || code) throw new Error(invalidLink);
    const result = await client.auth.setSession({ access_token: access, refresh_token: refresh });
    if (result.error || !result.data.user) throw new Error(invalidLink);
  } else if (code) {
    const result = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (result.error || !result.data.user) throw new Error(invalidLink);
  }

  // Never interpret an existing login alone as permission to change a password.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error(invalidLink);
  const response = await request("/api/members/invitations/verify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }), cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || invalidLink);
  if (result.userId !== data.user.id || typeof result.email !== "string") throw new Error(invalidLink);
  return { token, userId: result.userId, email: result.email };
}
