import { createClient } from "@/lib/supabase/client";

export async function continueWithGoogle() {
  const { error } = await createClient().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/membership`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}
