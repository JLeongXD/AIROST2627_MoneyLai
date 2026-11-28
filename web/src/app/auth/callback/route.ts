import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next =
    url.searchParams.get("next") === "/update-password"
      ? "/update-password"
      : url.searchParams.get("next") === "/membership"
        ? "/membership"
        : "/dashboard";
  if (code) {
    try {
      const client = await createServerSupabaseClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    } catch {}
  }
  return new Response(
    "This sign-in or recovery link is invalid or expired. Return to /login and request a new link.",
    { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
