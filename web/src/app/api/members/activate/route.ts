import { memberAdmin, memberId, memberJson, memberSession, sameOrigin } from "@/lib/members/server";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return memberJson({ error: "Invalid request origin." }, 403);
  try {
    const { user } = await memberSession();
    if (!user) return memberJson({ error: "This email link is invalid or expired. Ask the President to resend your invitation." }, 401);
    const body = await request.json().catch(() => null);
    if (!body || !memberId(body.token) || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)
      return memberJson({ error: "Use the latest invitation link and a password of 8 to 128 characters." }, 400);
    const admin = memberAdmin();
    const check = await admin.rpc("ml_validate_invitation", { p_user: user.id, p_token: body.token });
    if (check.error) return memberJson({ error: check.error.message }, 409);
    // Recipient's verified session determines the account. Ignore any supplied user ID/role.
    const update = await admin.auth.admin.updateUserById(user.id, { password: body.password });
    if (update.error) return memberJson({ error: "Password could not be set. Use a stronger password and try again." }, 400);
    const activate = await admin.rpc("ml_activate_member", { p_user: user.id, p_token: body.token });
    if (activate.error) return memberJson({ error: activate.error.message }, 409);
    return memberJson({ message: "Membership activated. You can now sign in with your email and password." });
  } catch {
    return memberJson({ error: "Membership could not be activated. Try again or ask the President to check your invitation." }, 503);
  }
}
