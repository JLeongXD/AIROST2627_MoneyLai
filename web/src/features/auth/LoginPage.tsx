"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { Field, Notice } from "@/components/UI";
import styles from "./LoginPage.module.css";
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
    <main className={styles.layout}>
      <section className={styles.story} aria-labelledby="story-title">
        <Link className={styles.brand} href="/" aria-label="MoneyLai home">
          <span className={styles.brandMark} aria-hidden="true">
            M
          </span>
          MoneyLai<span className={styles.brandDot}>.</span>
        </Link>
        <div className={styles.storyContent}>
          <span className={styles.eyebrow}>CLUB FINANCES, SIMPLIFIED</span>
          <h1 id="story-title">
            Less chasing.
            <br />
            <span>More creating.</span>
          </h1>
          <p>
            Give every expense a home. Keep budgets clear and reimbursements
            moving.
          </p>
          <div className={styles.workflow} aria-label="Reimbursement workflow">
            <div className={styles.workflowHeader}>
              <span>THE MONEYLAI WAY</span>
              <span aria-hidden="true">↗</span>
            </div>
            <ol>
              <li>
                <span className={styles.stepNumber}>01</span>
                <div>
                  <strong>Submit your claim</strong>
                  <small>Add your expenses and receipts.</small>
                </div>
              </li>
              <li>
                <span className={styles.stepNumber}>02</span>
                <div>
                  <strong>Keep everyone in the loop</strong>
                  <small>Follow your treasurer’s review.</small>
                </div>
              </li>
              <li>
                <span className={styles.stepNumber}>03</span>
                <div>
                  <strong>Get reimbursed</strong>
                  <small>One clear record, from start to finish.</small>
                </div>
              </li>
            </ol>
          </div>
        </div>
        <small className={styles.storyFooter}>
          Less paperwork. More possibilities.
        </small>
      </section>
      <section className={styles.formArea} aria-labelledby="login-title">
        <div className={styles.formCard}>
          <div className={styles.formIcon} aria-hidden="true">
            ↗
          </div>
          <span className={styles.formEyebrow}>
            {forgot ? "ACCOUNT RECOVERY" : "YOUR CLUB WORKSPACE"}
          </span>
          <h2 id="login-title">
            {forgot ? "Let’s get you back in." : "Welcome back."}
          </h2>
          <p className={styles.intro}>
            {forgot
              ? "We’ll help you get back into your account."
              : "Sign in to your club finance workspace."}
          </p>
          {accountError && <Notice tone="error">{accountError}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          <form
            className={styles.form}
            onSubmit={submit}
            noValidate
            aria-busy={busy}
          >
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
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </Field>
            )}
            <button className={styles.submit} disabled={busy}>
              {busy
                ? "Please wait…"
                : forgot
                  ? "Send recovery link"
                  : "Sign in →"}
            </button>
          </form>
          <button
            className={styles.switchButton}
            disabled={busy}
            onClick={() => {
              setForgot((v) => !v);
              setError("");
              setMessage("");
            }}
          >
            {forgot ? "Back to sign in" : "Forgot password?"}
          </button>
          <div className={styles.accountNote}>
            <span aria-hidden="true">◎</span>
            <p>
              <strong>New to MoneyLai?</strong>
              <br />
              Ask your club treasurer for an account.
            </p>
          </div>
        </div>
        <p className={styles.formFooter}>
          A little clarity for every club expense.
        </p>
      </section>
    </main>
  );
}
