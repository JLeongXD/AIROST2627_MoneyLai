import { memberAdmin, memberId, memberJson, memberSession, sameOrigin } from "@/lib/members/server";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return memberJson({ error: "Invalid request origin." }, 403);
  try {
    const { client, user } = await memberSession();
    if (!user) return memberJson({ error: "Please sign in again." }, 401);
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("role,account_status").eq("id", user.id).single();
    if (profileError || profile?.role !== "president" || profile.account_status !== "active")
      return memberJson({ error: "Active President access required." }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" ||
      (body.invitationId != null && !memberId(body.invitationId)) ||
      (body.invitationId == null && (typeof body.email !== "string" || typeof body.name !== "string")))
      return memberJson({ error: "Enter a name and email, or select an invitation to resend." }, 400);
    const admin = memberAdmin(); // Check configuration before rotating a pending invitation.
    const { data: invitation, error } = await client.rpc("ml_prepare_invitation", {
      p_email: body.invitationId ? "" : body.email,
      p_name: body.invitationId ? "" : body.name,
      p_invitation: body.invitationId ?? null,
    });
    if (error) return memberJson({ error: error.message }, 409);
    const redirectTo = `${new URL(request.url).origin}/join?invitation=${invitation.token}`;
    let sent = false;
    let mailError: unknown = null;
    try {
      // Keep the invitation email for unconfirmed users. An account that already
      // verified an earlier link needs recovery; Auth rejects another invite for it.
      const existing = invitation.existing_user ? await admin.auth.admin.getUserById(invitation.existing_user) : null;
      if (existing?.error) throw existing.error;
      const result = existing?.data.user?.email_confirmed_at
        ? await admin.auth.resetPasswordForEmail(invitation.email, { redirectTo })
        : await admin.auth.admin.inviteUserByEmail(invitation.email, {
          redirectTo, data: { display_name: invitation.display_name },
        });
      if (result.error) throw result.error;
      sent = true;
    } catch (error) {
      // Only map known error codes below. Never expose provider messages, email links or tokens.
      mailError = error;
    }
    const delivery = await admin.rpc("ml_invitation_delivery", {
      p_id: invitation.id, p_token: invitation.token, p_actor: user.id, p_success: sent,
    });
    if (delivery.error) return memberJson({ error: "Invitation changed or delivery status could not be saved. Refresh Members before resending." }, 409);
    if (!sent) {
      const code = mailError && typeof mailError === "object" && "code" in mailError ? mailError.code : null;
      const message = code === "email_address_not_authorized"
        ? "Invitation saved, but Supabase's default email service cannot send to this address. Configure Custom SMTP for club members, then use Resend. (email_address_not_authorized)"
        : code === "over_email_send_rate_limit"
          ? "Invitation saved, but Supabase's email sending limit has been reached. Wait for the sending quota to reset, or configure Custom SMTP and check Auth Rate Limits, then use Resend. (over_email_send_rate_limit)"
          : code === "over_request_rate_limit"
            ? "Invitation saved, but Supabase is rate-limiting requests. Wait before using Resend again. (over_request_rate_limit)"
            : "Invitation saved, but email delivery failed. Check Supabase Auth logs for the failed invite/recover request and verify SMTP settings and limits, then use Resend.";
      return memberJson({ error: message }, 502);
    }
    return memberJson({ message: "Invitation email sent. The recipient opens the latest email and sets their own password to join as a Member." });
  } catch {
    return memberJson({ error: "Invitation could not be sent. Check server configuration and migration 014, then refresh Members." }, 503);
  }
}
