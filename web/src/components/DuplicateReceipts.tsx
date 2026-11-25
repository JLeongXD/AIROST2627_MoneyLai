"use client";
import Link from "next/link";
import { useState } from "react";
import { rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { money, STATUS_LABELS, errorMessage } from "@/lib/domain";
import type { ClaimStatus } from "@/lib/types";
import { Notice } from "./UI";
import { useFeedback, useOperationError } from "./FeedbackProvider";
type Match = { claim_id: string; status: ClaimStatus; amount: string; current_file: string; matched_file: string; basis: string; merchant: string | null; purchase_date: string | null; receipt_amount: string | null; receipt_number: string | null };
export default function DuplicateReceipts({ claimId }: { claimId: string }) {
  const state = useLoad(() => rpc<Match[]>("ml_receipt_duplicates", { p_claim_id: claimId }), [claimId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useOperationError("Receipt indexing failed");
  const notify = useFeedback();
  async function reindex() {
    if (busy) return;
    setBusy(true); setError("");
    notify({ title: "Indexing receipt files…", tone: "progress" });
    try {
      const res = await fetch(`/api/claims/${claimId}/receipt-index`, { method: "POST", signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw Error((await res.json()).error || "Unable to index receipts.");
      notify({ title: "Receipt files indexed", description: "Next: review the updated duplicate matches below. Matches are hints; compare the original receipts before deciding." });
      state.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="panel duplicate-panel"><span className="eyebrow">TREASURER EVIDENCE CHECK</span><h2>Possible duplicate receipts</h2>
    <p>Matches are review hints, not proof of duplicate reimbursement. Confirm the originals before deciding.</p>
    {(error || state.error) && <Notice tone="error">{error || state.error}</Notice>}
    {state.data?.length === 0 && <p>No matches found among indexed receipts.</p>}
    {state.data?.map((m, i) => <article className="clarification-item" key={`${m.claim_id}-${i}`}>
      <strong>{m.basis === "identical_file" ? "Identical file content (SHA-256)" : "Same extracted merchant, date, amount and currency"}</strong>
      <p>{m.current_file} ↔ {m.matched_file}</p>
      {m.basis !== "identical_file" && <p>{m.merchant} · {m.purchase_date} · {money(m.receipt_amount)}{m.receipt_number ? ` · Receipt ${m.receipt_number}` : ""}. Separate purchases can share these details.</p>}
      <Link href={`/claims/${m.claim_id}`}>Review claim {m.claim_id.slice(0, 8)} · {STATUS_LABELS[m.status]} · {money(m.amount)}</Link>
    </article>)}
    <small>Coverage: files indexed after upload or AI checks. Historical files must be indexed too. Detail matching needs a completed AI check; unreadable or missing fields are not guessed. Other claimants’ drafts are excluded.</small>
    <div className="form-actions"><button className="button secondary" disabled={busy} onClick={reindex}>{busy ? "Indexing…" : "Index this claim’s files & recheck"}</button></div>
  </section>;
}
