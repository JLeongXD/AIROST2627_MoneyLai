import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchClaimEmails } from "@/lib/notifications/email";
import { memberId, memberJson, memberSession, sameOrigin } from "@/lib/members/server";

export const runtime = "nodejs";
export const maxDuration = 180;

// A protected scheduler drains durable retries even after the browser closes.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return memberJson({ error: "Unauthorized" }, 401);
  try {
    const result = await dispatchClaimEmails(null, 5);
    return memberJson(result, result.configured ? 200 : 503);
  } catch {
    return memberJson({ error: "Email dispatch unavailable. Pending notifications will retry." }, 503);
  }
}

// Best-effort immediate dispatch after a successful financial RPC.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return memberJson({ error: "Invalid origin" }, 403);
  const { client, user } = await memberSession();
  if (!user) return memberJson({ error: "Sign in required" }, 401);
  const { data: profile } = await client.from("profiles").select("role,account_status").eq("id", user.id).single();
  if (profile?.role !== "treasurer" || profile.account_status !== "active") return memberJson({ error: "Treasurer access required" }, 403);
  const body = await request.json().catch(() => null);
  if (!memberId(body?.claimId)) return memberJson({ error: "Invalid claim" }, 400);
  after(async () => {
    try { await dispatchClaimEmails(body.claimId); }
    catch { console.error("Claim email dispatch unavailable; notification remains queued."); }
  });
  return memberJson({ queued: true }, 202);
}
