import "server-only";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

type Notification = {
  id: string; claim_id: string; recipient_id: string; lease_token: string;
  kind: "approved" | "paid";
  payload: { claim_number: string; amount: number; activity: string; paid_on: string | null; reference: string | null };
};

export function notificationText(item: Notification, origin: string) {
  const p = item.payload;
  const amount = new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(Number(p.amount));
  const approved = item.kind === "approved";
  return {
    subject: `MoneyLai: claim ${p.claim_number} ${approved ? "approved" : "payment recorded"}`.replace(/[\r\n]/g, " "),
    text: [
      approved ? "Your claim has been approved and is awaiting payment." : "Your Treasurer has recorded your reimbursement as paid in MoneyLai.",
      `Claim: ${p.claim_number}`, `Activity: ${p.activity}`, `Amount: ${amount}`,
      ...(!approved ? [`Payment date: ${p.paid_on ?? "See claim details"}`, `Reference: ${p.reference ?? "See claim details"}`] : []),
      `View claim: ${new URL(`/claims/${item.claim_id}`, origin).href}`,
      "Sign in to MoneyLai to view the details. Replies to this email do not update your claim.",
    ].join("\n\n"),
  };
}

export async function dispatchClaimEmails(claimId: string | null = null, limit = 1) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origin = process.env.APP_URL;
  // Leave the queue intact until delivery is configured.
  if (!user || !pass || !url || !key || !origin) return { configured: false, sent: 0, failed: 0 };
  const parsed = new URL(origin);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Invalid APP_URL");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  let sent = 0, failed = 0;
  for (let i = 0; i < Math.min(limit, 5); i++) {
    const { data, error } = await admin.rpc("ml_take_claim_email", { p_claim_id: claimId });
    if (error) throw new Error("Unable to lease email notification");
    const item = data?.[0] as Notification | undefined;
    if (!item) break;
    let success = false;
    try {
      const { data: recipient, error: lookupError } = await admin.auth.admin.getUserById(item.recipient_id);
      if (lookupError || !recipient.user?.email || !recipient.user.email_confirmed_at) throw new Error("Recipient unavailable");
      // Recheck the lease after lookup to avoid sending an approval cancelled in the meantime.
      const { data: current, error: checkError } = await admin.from("claim_email_notifications")
        .select("id").eq("id", item.id).eq("status", "sending").eq("lease_token", item.lease_token).maybeSingle();
      if (checkError) throw new Error("Unable to verify notification");
      if (!current) continue;
      const result = await transport.sendMail({
        from: { name: "MoneyLai", address: user }, to: recipient.user.email,
        messageId: `<moneylai-${item.id}@${user.split("@")[1]}>`,
        ...notificationText(item, parsed.origin),
      });
      success = result.accepted.length > 0;
    } catch {
      // Provider errors can contain addresses or credentials; persist only a generic error.
      success = false;
    }
    const { error: finishError } = await admin.rpc("ml_finish_claim_email", { p_id: item.id, p_lease: item.lease_token, p_success: success });
    if (finishError) throw new Error("Unable to save email delivery result");
    if (success) sent++; else failed++;
  }
  return { configured: true, sent, failed };
}
