"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { Field, Notice } from "@/components/UI";
import styles from "./LoginPage.module.css";
import { continueWithGoogle } from "@/lib/members/google";
export default function LoginPage() {
  const { user, ready, error: accountError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [switching, setSwitching] = useState(false);
  const signOutPending = useRef(false);
  async function signInWithAnotherAccount() {
    if (!ready || busy || signOutPending.current) return;
    signOutPending.current = true;
    setSwitching(true); setError(""); setMessage("");
    try {
      const client = createClient();
      const result = await client.auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      const session = await client.auth.getSession();
      if (session.error) throw session.error;
      if (session.data.session) throw new Error("Sign-out is not complete. Please try again.");
      setEmail(""); setPassword(""); setForgot(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSwitching(false); signOutPending.current = false;
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || user || switching || busy) return;
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
      <div className={styles.scenery} aria-hidden="true">
        <div className={styles.glassOrb} />
        <div className={styles.glassRing} />
        <div className={styles.glassPebble} />
      </div>
      <section className={styles.story} aria-labelledby="story-title">
        <Link className={styles.brand} href="/" aria-label="MoneyLai home">
          <span className={styles.brandMark} aria-hidden="true">
            M
          </span>
          MoneyLai<span className={styles.brandDot}>.</span>
        </Link>
        <div className={styles.storyContent}>
          <span className={styles.eyebrow}>A LITTLE CLARITY. A LOT LESS ADMIN.</span>
          <h1 id="story-title">
            Club finances,
            <br />
            <span>all in one place.</span>
          </h1>
          <p>
            Submit expense claims, track reimbursements, and manage your club’s budget.
          </p>
          <div className={styles.features} aria-label="Workspace features">
            <span>Expense claims</span><span>Club budgets</span><span>Reimbursements</span>
          </div>
        </div>
        <p className={styles.storyFooter}>More time for your club. Less time on the paperwork.</p>
      </section>
      <section className={styles.formArea} aria-labelledby="login-title">
        <div className={styles.formCard}>
          <div className={styles.cardHeading}>
            <span className={styles.cardIcon} aria-hidden="true">
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg>
            </span>
            <span>YOUR CLUB WORKSPACE</span>
          </div>
          <h2 id="login-title">
            {forgot ? "Reset your password" : "Welcome to MoneyLai"}
          </h2>
          <p className={styles.intro}>
            {ready && user
              ? "Continue with your current account or sign in with another."
              : forgot
              ? "We’ll help you get back into your account."
              : "Sign in or request access to your club’s workspace."}
          </p>
          {accountError && <Notice tone="error">{accountError}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          {!ready || switching ? <p role="status">{switching ? "Signing out…" : "Checking your sign-in status…"}</p>
          : user ? <section className={styles.accountChoice} aria-label="Choose an account">
            <p>Currently signed in as <strong>{user.email ?? "your current account"}</strong></p>
            <button type="button" className={styles.submit} onClick={() => router.replace("/dashboard")}>Continue with this account</button>
            <button type="button" className={styles.otherAccount} onClick={() => void signInWithAnotherAccount()}>Sign in with another account</button>
          </section> : <>
          {!forgot && <><button type="button" className={styles.googleButton} aria-describedby="google-help approval-note" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await continueWithGoogle(); } catch (e) { setError(errorMessage(e)); setBusy(false); }
          }}>
            <svg className={styles.googleLogo} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.05a10 10 0 0 0 0 9l3.35-2.59Z" />
              <path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.35 2.59c.79-2.36 3-4.12 5.6-4.12Z" />
            </svg>
            <span>Continue with Google</span>
          </button>
          <p id="google-help" className={styles.googleHelp}>Existing member? Sign in. New here? Continue to apply.</p>
          <aside id="approval-note" className={styles.approvalNote}>
            <strong>President approval required</strong>
            <p>New users must submit an application after Google sign-in. Your club president must approve it before you can use MoneyLai.</p>
          </aside>
          <div className={styles.divider}>or sign in with email</div></>}
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
                  : "Sign in"}
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
          </>}
        </div>
      </section>
    </main>
  );
}
