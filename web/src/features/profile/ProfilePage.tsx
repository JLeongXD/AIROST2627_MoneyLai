"use client";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader, Notice, Loading, Field } from "@/components/UI";
import { getPayout, rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { errorMessage } from "@/lib/domain";
import type { Payout } from "@/lib/types";
import { useFeedback, useOperationError } from "@/components/FeedbackProvider";
export default function ProfilePage() {
  const { user } = useAuth();
  const state = useLoad(() => getPayout(user!.id), [user?.id]);
  return (
    <>
      <PageHeader
        eyebrow="A FEW DETAILS, LESS DELAY"
        title="My profile"
        description="Keep your name and payout details up to date."
      />
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <Notice tone="error">{state.error}</Notice>
      ) : (
        <ProfileForm payout={state.data} />
      )}
    </>
  );
}
function ProfileForm({ payout }: { payout: Payout | null }) {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [recipient, setRecipient] = useState(payout?.recipient_name ?? "");
  const [provider, setProvider] = useState(payout?.provider_name ?? "");
  const [account, setAccount] = useState(payout?.account_number ?? "");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useOperationError("Profile could not be saved");
  const notify = useFeedback();
  const [message, setMessage] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setMessage("");
    if (!name.trim()) {
      setError("Enter a display name.");
      return;
    }
    if (
      [recipient, provider, account].some((v) => v.trim()) &&
      (!recipient.trim() || !provider.trim() || account.trim().length < 3)
    ) {
      setError(
        "Complete all payout fields, including an account number of at least 3 characters.",
      );
      return;
    }
    setBusy(true);
    notify({ title: "Saving profile…", tone: "progress" });
    try {
      await rpc("ml_save_profile", {
        p_display_name: name,
        p_recipient: recipient,
        p_provider: provider,
        p_account: account,
      });
      refreshProfile();
      setMessage("Profile and payout details saved.");
      notify({ title: "Profile saved", description: recipient.trim() && provider.trim() && account.trim() ? "Your payout details are ready. Return to your draft to review and submit it." : "Your name is saved. Add complete payout details here before submitting a claim.", href: "/claims", label: "View my claims" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="detail-grid profile-workspace">
      <section className="panel">
        <h2>Personal & payout details</h2>
        {error && <Notice tone="error">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        <form onSubmit={save} noValidate>
          <fieldset disabled={busy}>
            <Field label="Display name" id="display-name">
              <input
                id="display-name"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Email" id="profile-email">
              <input id="profile-email" value={user?.email ?? ""} disabled />
            </Field>
            <hr />
            <h3>Where should your reimbursement go?</h3>
            <Field label="Account holder name" id="recipient">
              <input
                id="recipient"
                maxLength={100}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </Field>
            <Field label="Bank or e-wallet provider" id="provider">
              <input
                id="provider"
                maxLength={100}
                placeholder="e.g. Maybank"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
            </Field>
            <Field label="Account number" id="account">
              <div className="input-with-action">
                <input
                  id="account"
                  type={reveal ? "text" : "password"}
                  autoComplete="off"
                  maxLength={50}
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                />
                <button type="button" onClick={() => setReveal((v) => !v)}>
                  {reveal ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
            <button className="button primary">
              {busy ? "Saving…" : "Save profile"}
            </button>
          </fieldset>
        </form>
      </section>
      <aside className="panel guidance">
        <span className="eyebrow">YOUR DETAILS STAY PRIVATE</span>
        <h2>Ready when it’s time to pay.</h2>
        <p>
          Only you and authorised treasurers can access your payout details.
          Other members cannot see them.
        </p>
        <p>
          Check the account number carefully. Your treasurer transfers the money
          outside MoneyLai and records the payment here.
        </p>
        <p>
          Previously recorded payments retain the recipient details used at the
          time.
        </p>
        <span className="role-tag">
          {profile?.role === "president"
            ? "President"
            : profile?.role === "treasurer"
              ? "Treasurer"
              : "Member"}
        </span>
      </aside>
    </div>
  );
}
