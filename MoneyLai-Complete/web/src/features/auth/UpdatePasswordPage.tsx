"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { Field, Notice } from "@/components/UI";
export default function UpdatePasswordPage() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const c = createClient();
      const { data, error: authError } = await c.auth.getUser();
      if (authError || !data.user)
        throw new Error(
          "Recovery link is invalid or expired. Request a new link.",
        );
      const { error } = await c.auth.updateUser({ password });
      if (error) throw error;
      await c.auth.signOut();
      router.replace("/login");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="setup-screen">
      <div className="panel narrow">
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h1>Set a new password</h1>
        <p>You will be returned to sign in after updating.</p>
        {error && <Notice tone="error">{error}</Notice>}
        {ready && !user ? (
          <Notice tone="error">
            This link is invalid or expired.{" "}
            <Link href="/login">Request another recovery link.</Link>
          </Notice>
        ) : (
          <form onSubmit={submit} noValidate>
            <Field label="New password" id="password">
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field label="Confirm password" id="confirm">
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
            </Field>
            <button className="button primary" disabled={busy || !ready}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
        <Link href="/login" className="back-link">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
