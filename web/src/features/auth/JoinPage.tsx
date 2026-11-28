"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useFeedback } from "@/components/FeedbackProvider";
import { Field, Notice } from "@/components/UI";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/domain";
import { verifyInvitationSession, type VerifiedInvitation } from "@/lib/members/invitation-session";
import styles from "@/features/members/MembersPage.module.css";

export default function JoinPage() {
  const { user, ready, refreshProfile } = useAuth();
  const notify = useFeedback();
  const router = useRouter();
  const [verified, setVerified] = useState<VerifiedInvitation | null>(null);
  const [checking, setChecking] = useState(true);
  const verification = useRef<Promise<VerifiedInvitation> | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    // Reuse the in-flight exchange in Strict Mode: email codes are single-use.
    const href = window.location.href;
    verification.current ??= Promise.resolve().then(() => verifyInvitationSession(createClient(), href,
      url => window.history.replaceState(null, "", url)));
    void verification.current.then(value => { if (active) setVerified(value); })
      .catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !verified || checking) return;
    if (password.length < 8 || password.length > 128) { setError("Use a password of 8 to 128 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const identity = await createClient().auth.getUser();
      if (identity.error || identity.data.user?.id !== verified.userId) throw new Error("Your signed-in account changed. Reopen the invitation email before setting a password.");
      const response = await fetch("/api/members/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: verified.token, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Membership could not be activated.");
      setPassword(""); setConfirm(""); refreshProfile();
      // Use the new password for the next login; remove the invitation token from history.
      await createClient().auth.signOut({ scope: "local" });
      window.history.replaceState(null, "", "/join");
      notify({ title: "Welcome to MoneyLai", description: "Your Member account is ready. Sign in with your email and new password." });
      router.replace("/login");
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <main className="setup-screen"><div className={`panel ${styles.welcome}`}>
    <span className="eyebrow">YOU’RE INVITED</span><h1>Join your club on MoneyLai</h1>
    <p>Set your own password to activate your Member account. Your club President manages Treasurer appointments.</p>
    {error && <Notice tone="error">{error}</Notice>}
    {checking ? <p role="status">Verifying the invitation and its recipient…</p>
      : verified && !ready ? <p role="status">Loading the verified Member account…</p>
      : verified && user?.id === verified.userId ? <form onSubmit={submit}>
        <Notice>Set a password for the invited Member: <strong>{verified.email}</strong>.</Notice>
        <Field id="join-password" label="Choose a password"><input id="join-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
        <Field id="join-confirm" label="Confirm password"><input id="join-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} /></Field>
        <button className="button primary" disabled={busy}>{busy ? "Activating membership…" : "Set password & join"}</button>
      </form> : <Notice>No password can be changed here until this invitation matches your verified account.{user?.email && <> Currently signed in as <strong>{user.email}</strong>.</>}</Notice>}
    <div className={styles.actions}><Link href="/login">Back to sign in</Link>{user && <button className="button secondary" disabled={busy} onClick={async () => { await createClient().auth.signOut({ scope: "local" }); router.replace("/login"); }}>Sign out</button>}</div>
  </div></main>;
}
