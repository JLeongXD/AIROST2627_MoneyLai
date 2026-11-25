"use client";
import Link from "next/link";
import { useState } from "react";
import { useLoad } from "@/lib/useLoad";
import { createClient } from "@/lib/supabase/client";
import { rpc } from "@/lib/api";
import { dateTime, errorMessage } from "@/lib/domain";
import type { Claim } from "@/lib/types";
import { Notice } from "./UI";
import { useFeedback, useOperationError } from "./FeedbackProvider";
import { feedbackFor } from "@/lib/workflow-feedback";
type Clarification = { id: string; question: string; reply: string | null; requested_at: string; responded_at: string | null };
export default function ClaimClarifications({ claim, owner, onChanged }: { claim: Claim; owner: boolean; onChanged: () => void }) {
  const state = useLoad(async () => {
    const { data, error } = await createClient().from("claim_clarifications").select("id,question,reply,requested_at,responded_at").eq("claim_id", claim.id).order("requested_at", { ascending: false });
    if (error) throw error;
    return data as Clarification[];
  }, [claim.id]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useOperationError("Response could not be sent");
  const notify = useFeedback();
  async function act(start: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    notify({ title: feedbackFor(start ? "revised" : "replied", claim.id).pending, tone: "progress" });
    try {
      await rpc(start ? "ml_return_to_draft" : "ml_reply_information", start ? { p_claim_id: claim.id } : { p_claim_id: claim.id, p_reply: reply });
      if (!start) setReply("");
      notify(feedbackFor(start ? "revised" : "replied", claim.id));
      state.reload(); onChanged();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  if (state.error) return <Notice tone="error">Unable to load clarification history. {state.error}</Notice>;
  if (!state.data?.length) return null;
  const open = state.data.find((r) => !r.responded_at);
  return <section className="panel clarification-panel" id="clarifications" aria-busy={busy}>
    <span className="eyebrow">KEEP THE CONVERSATION WITH THE CLAIM</span>
    <h2>{open ? "Information requested" : "Clarification history"}</h2>
    {open && <Notice>Waiting for the claimant since {dateTime(open.requested_at)}. Update the draft and reply before resubmitting.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {state.data.map((r) => <article className="clarification-item" key={r.id}>
      <strong>Treasurer’s request · {dateTime(r.requested_at)}</strong><p>{r.question}</p>
      {r.responded_at && <><strong>Claimant’s reply · {dateTime(r.responded_at)}</strong><p>{r.reply}</p></>}
    </article>)}
    {owner && open && claim.status === "needs_info" && <button className="button primary" disabled={busy} onClick={() => act(true)}>{busy ? "Preparing draft…" : "Prepare response & edit draft"}</button>}
    {owner && open && claim.status === "draft" && <form onSubmit={(e) => { e.preventDefault(); void act(false); }}>
      <div className="form-actions"><Link className="button secondary" href={`/claims/${claim.id}/edit`}>Edit expense details</Link><a className="button secondary" href="#supporting-documents">Update receipts</a></div>
      <label className="reply-field" htmlFor="information-reply">Explain what you corrected or supplied</label>
      <textarea id="information-reply" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} rows={4} disabled={busy} />
      <button className="button primary" disabled={busy || reply.trim().length < 3}>{busy ? "Resubmitting…" : "Send reply & resubmit"}</button>
    </form>}
  </section>;
}
