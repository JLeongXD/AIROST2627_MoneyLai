import { memberAdmin, memberId, memberJson, memberSession, sameOrigin } from "@/lib/members/server";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return memberJson({ error: "Invalid request origin." }, 403);
  try {
    const body = await request.json().catch(() => null);
    if (!body || !memberId(body.token)) return memberJson({ error: "Open the complete invitation link from your latest email." }, 400);
    const { user } = await memberSession();
    if (!user) return memberJson({ error: "The email link could not verify your identity. Open the latest invitation email or ask for a new one." }, 401);
    const check = await memberAdmin().rpc("ml_validate_invitation", { p_user: user.id, p_token: body.token });
    if (check.error) return memberJson({ error: "This invitation does not match the current account, or has expired, been replaced or already accepted. Sign out and reopen the latest invitation email for the intended Member." }, 409);
    return memberJson({ userId: user.id, email: user.email });
  } catch {
    return memberJson({ error: "Invitation verification is unavailable. Try again or ask the President to check the setup." }, 503);
  }
}
