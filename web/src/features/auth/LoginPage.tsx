"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { Field, Notice } from "@/components/UI";
export default function LoginPage() {
  const { user, ready, error: accountError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (ready && user && !accountError) router.replace("/dashboard");
  }, [ready, user, accountError, router]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    if (!forgot && !password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      const client = createClient();
      if (forgot) {
        const { error } = await client.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
          },
        );
        if (error) throw error;
        setMessage(
          "If this account exists, a recovery link will be sent. Check your inbox.",
        );
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error)
          throw new Error("Unable to sign in. Check your email and password.");
        setPassword("");
        router.replace("/dashboard");
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Link className="brand" href="/">
          <span className="brand-mark">M</span>MoneyLai.
        </Link>
        <div>
          <span className="eyebrow">MADE FOR YOUR CLUB</span>
          <h1>
            Less chasing.
            <br />
            More creating.
          </h1>
          <p>
            Give every expense a home. Keep budgets clear and reimbursements
            moving.
          </p>
          <div className="auth-story-tags">
            <span>01 / Submit</span>
            <span>02 / Review</span>
            <span>03 / Reimburse</span>
          </div>
        </div>
        <small>Your next great event starts with a little clarity.</small>
      </section>
      <section className="auth-form-area">
        <div className="auth-card">
          <span className="eyebrow">WELCOME TO MONEYLAI</span>
          <h2>{forgot ? "Forgot your password?" : "Welcome back."}</h2>
          <p>
            {forgot
              ? "We’ll help you get back into your account."
              : "Sign in to your club finance workspace."}
          </p>
          {accountError && <Notice tone="error">{accountError}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          <form onSubmit={submit} noValidate>
            <Field label="Email address" id="email">
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={busy}
              />
            </Field>
            {!forgot && (
              <Field label="Password" id="password">
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </Field>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? "Please wait…"
                : forgot
                  ? "Send recovery link"
                  : "Sign in →"}
            </button>
          </form>
          <button
            className="text-button auth-switch"
            onClick={() => {
              setForgot((v) => !v);
              setError("");
              setMessage("");
            }}
          >
            {forgot ? "Back to sign in" : "Forgot password?"}
          </button>
          <p className="auth-note">
            New here? Ask your club treasurer for an account.
          </p>
        </div>
      </section>
    </main>
  );
}
