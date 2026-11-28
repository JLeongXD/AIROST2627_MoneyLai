import { memberAdmin, memberJson, memberSession, sameOrigin } from "@/lib/members/server";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return memberJson({ error: "Invalid request origin." }, 403);
  try {
    const { user } = await memberSession();
    if (!user) return memberJson({ error: "Sign in again before setting your password." }, 401);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128)
      return memberJson({ error: "Use a password of 8 to 128 characters." }, 400);
    const admin = memberAdmin();
    const check = await admin.rpc("ml_validate_membership_activation", { p_user: user.id });
    if (check.error) return memberJson({ error: "President approval is required before activation. Refresh your application status." }, 409);
    const update = await admin.auth.admin.updateUserById(user.id, { password: body.password });
    if (update.error) return memberJson({ error: "Password could not be set. Use a stronger password and try again." }, 400);
    // Recheck approval in the activation transaction; a concurrent rejection must not grant access.
    const complete = await admin.rpc("ml_complete_membership", { p_user: user.id });
    if (complete.error) return memberJson({ error: "Membership could not be activated. Refresh your status and try again." }, 409);
    return memberJson({ message: "Membership activated." });
  } catch {
    return memberJson({ error: "Activation is unavailable. Please try again." }, 503);
  }
}
