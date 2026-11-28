"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Field, Notice } from "@/components/UI";
import { createClient } from "@/lib/supabase/client";
import { rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { errorMessage } from "@/lib/domain";
import { continueWithGoogle } from "@/lib/members/google";

type Application = { status: "pending" | "approved" | "rejected" | "completed"; reason: string | null };
export default function MembershipPage() {
  const { user, profile, ready, error: authError, refreshProfile } = useAuth();
  const router = useRouter();
  const state = useLoad(() => user ? rpc<Application | null>("ml_membership_status") : Promise.resolve(null), [user?.id]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (ready && profile?.account_status === "active") router.replace("/dashboard"); }, [ready, profile?.account_status, router]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function activate(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    await run(async () => {
      const response = await fetch("/api/members/applications/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Activation failed.");
      setPassword(""); setConfirm(""); refreshProfile(); state.reload();
      router.replace("/dashboard");
    });
  }
  const google = user?.identities?.some(i => i.provider === "google");
  const application = state.data;
  return <main className="setup-screen"><div className="panel narrow">
    <span className="eyebrow">JOIN YOUR CLUB</span><h1>Join MoneyLai</h1>
    {(error || authError) && <Notice tone="error">{error || authError}</Notice>}
    {!ready ? <p role="status">Checking your account…</p> : !user ? <>
      <p>Verify your Google account, then submit a membership application. After President approval, set your MoneyLai password to activate access.</p>
      <button className="button primary" disabled={busy} onClick={() => void run(continueWithGoogle)}>Continue with Google</button>
    </> : <>
      <p>Signed in as <strong>{user.email}</strong></p>
      {profile?.account_status === "disabled" ? <Notice>Your account is disabled. Contact the President to restore access.</Notice>
      : profile?.account_status === "active" ? <Link href="/dashboard">Open workspace</Link>
      : state.loading ? <p role="status">Checking your application…</p>
      : state.error ? <Notice tone="error">{state.error}</Notice>
      : application?.status === "pending" ? <Notice>Your application has been submitted. Waiting for President approval. You can return later using Google; this page also refreshes automatically.</Notice>
      : application?.status === "rejected" ? <Notice>Your application was declined. {application.reason} Contact the President if this needs reconsideration.</Notice>
      : application?.status === "approved" ? <form onSubmit={activate}>
        <Notice tone="success">Approved! Set your MoneyLai password to activate your membership. This does not change your Google password.</Notice>
        <Field id="membership-password" label="MoneyLai password"><input id="membership-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
        <Field id="membership-confirm" label="Confirm password"><input id="membership-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} /></Field>
        <button className="button primary" disabled={busy}>{busy ? "Activating…" : "Set password & activate"}</button>
      </form> : <>
        <p>Your account has no club access yet. Submit an application for the President to review.</p>
        {google ? <button className="button primary" disabled={busy} onClick={() => void run(async () => { await rpc("ml_request_membership"); state.reload(); })}>{busy ? "Submitting…" : "Submit membership application"}</button>
        : <p>To apply, sign out and continue with Google using this same email address. If you received an invitation, you can also open its email link.</p>}
      </>}
      <p><button className="button secondary" disabled={busy} onClick={() => void run(async () => { const result = await createClient().auth.signOut({ scope: "local" }); if (result.error) throw result.error; router.replace("/login"); })}>Sign out</button></p>
      <button className="text-button" disabled={busy || state.loading} onClick={state.reload}>Refresh status</button>
    </>}
    <p><Link href="/login">Back to sign in</Link></p>
  </div></main>;
}
