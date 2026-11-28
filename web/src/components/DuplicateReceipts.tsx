"use client";
import Link from "next/link";
import { useState } from "react";
import { rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { money, STATUS_LABELS, errorMessage, claimCode } from "@/lib/domain";
import type { Claim, ClaimStatus } from "@/lib/types";
import { Notice } from "./UI";
import { useFeedback, useOperationError } from "./FeedbackProvider";
import styles from "./DuplicateReceipts.module.css";
type Match = { claim_id: string; status: ClaimStatus; amount: string; current_file: string; matched_file: string; basis: string; merchant: string | null; purchase_date: string | null; receipt_amount: string | null; receipt_number: string | null };
export default function DuplicateReceipts({ claimId, compact = false, embedded = false, claims = [] }: { claimId: string; compact?: boolean; embedded?: boolean; claims?: Claim[] }) {
  const state = useLoad(() => rpc<Match[]>("ml_receipt_duplicates", { p_claim_id: claimId }), [claimId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useOperationError("Receipt indexing failed");
  const notify = useFeedback();
  async function reindex() {
    if (busy) return;
    setBusy(true); setError("");
    notify({ title: "Checking duplicate receipts…", tone: "progress" });
    try {
      const res = await fetch(`/api/claims/${claimId}/receipt-index`, { method: "POST", signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw Error((await res.json()).error || "Unable to index receipts.");
      notify({ title: "Duplicate check updated", description: "Compare any matching original receipts before deciding." });
      state.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const priority: Partial<Record<ClaimStatus, number>> = { paid: 0, approved: 1, submitted: 2, needs_info: 3 };
  const matches = [...(state.data ?? [])].sort((a, b) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4));
  const matchedClaims = new Set(matches.map(m => m.claim_id)).size;
  const committedMatches = new Set(matches.filter(m => m.status === "paid" || m.status === "approved").map(m => m.claim_id)).size;
  const content = <>
    <p>Matches are review hints, not proof of duplicate reimbursement. Confirm the originals before deciding.</p>
    {state.data?.length === 0 && <p>No matches found among indexed receipts.</p>}
    {matches.map((m, i) => { const matchedClaim = claims.find(c => c.id === m.claim_id); return <article className={styles.match} key={`${m.claim_id}-${i}`}>
      <Link href={`/claims/${m.claim_id}`}><strong>{claimCode(matchedClaim ?? { id: m.claim_id })}</strong>{matchedClaim?.claimant?.display_name && ` · ${matchedClaim.claimant.display_name}`}</Link>
      <span>{STATUS_LABELS[m.status]} · {money(m.amount)}</span>
      <small>{m.basis === "identical_file" ? "Same receipt file" : "Matching receipt details"} · {m.current_file} ↔ {m.matched_file}</small>
      {m.basis !== "identical_file" && <p>{m.merchant} · {m.purchase_date} · {money(m.receipt_amount)}{m.receipt_number ? ` · Receipt ${m.receipt_number}` : ""}. Separate purchases can share these details.</p>}
    </article>; })}
    <details className={styles.coverage}><summary>About this check</summary><small>Only indexed receipts are compared. Older files may need a recheck. Detail matching needs a completed AI check; unreadable or missing fields are not guessed. Other claimants’ drafts are excluded.</small></details>
    <div className="form-actions"><button className="button secondary" disabled={busy} onClick={reindex}>{busy ? "Checking…" : "Recheck duplicate receipts"}</button></div>
  </>;
  return <section className={embedded ? styles.embedded : "panel duplicate-panel"} aria-label="Duplicate receipt check">
    {(error || state.error) && <Notice tone="error">{error || state.error}</Notice>}
    {compact ? <>
      <h3>Duplicate receipts</h3>
      <p>{state.loading ? "Checking indexed receipts…" : state.error ? "Could not check for duplicates. Inspect the original receipts."
        : matchedClaims ? `${matchedClaims} possible matching ${matchedClaims === 1 ? "claim" : "claims"}${committedMatches ? ` · ${committedMatches} approved or reimbursed` : ""}. Compare the originals.` : "No matches found among indexed receipts."}</p>
      <details><summary>{matchedClaims ? "Compare matching claims" : "Check details & recheck"}</summary>{content}</details>
    </> : <><span className="eyebrow">TREASURER EVIDENCE CHECK</span><h2>Possible duplicate receipts</h2>{content}</>}
  </section>;
}
