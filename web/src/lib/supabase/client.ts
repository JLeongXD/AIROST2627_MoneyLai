import { createBrowserClient } from "@supabase/ssr";
import { browserFetch } from "../browser-fetch";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase configuration.");
  }

  return createBrowserClient(url, key, {
    global: { fetch: browserFetch },
    // Invitation emails use implicit links, while the normal client uses PKCE.
    // Join explicitly consumes and verifies its link before offering a password form.
    auth: {
      detectSessionInUrl: typeof window === "undefined" || window.location.pathname !== "/join",
    },
  });
}
