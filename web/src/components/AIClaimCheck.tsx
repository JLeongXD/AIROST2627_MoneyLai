"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/useLoad";
import { checkSignature, type SavedCheck } from "@/lib/ai/claim-check";
import type { Claim, Attachment } from "@/lib/types";
import { FileLink, Notice } from "./UI";
import { dateTime, money } from "@/lib/domain";
import styles from "./AIClaimCheck.module.css";
import Link from "next/link";
import { coachFindings, reviewFindingGroups } from "@/lib/ai/coach";
import type { ReceiptPlan } from "@/lib/ai/receipt-allocation";
import { useAuth } from "./AuthProvider";
import { useFeedback, useOperationError } from "./FeedbackProvider";

export default function AIClaimCheck({
  claim,
  attachments,
  onChanged,
  receiptPlan = null,
  compact = false,
  reviewer = false,
  embedded = false,
  onBusyChange,
  onEditDetails,
  onEditReceipt,
}: {
  claim: Claim;
  attachments: Attachment[];
  onChanged: () => void;
  receiptPlan?: ReceiptPlan | null;
  compact?: boolean;
  reviewer?: boolean;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onEditDetails?: () => void;
  onEditReceipt?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { user } = useAuth();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useOperationError("AI check could not be completed");
  const notify = useFeedback();
  const signature = checkSignature(claim, attachments, receiptPlan?.revision);
  const state = useLoad(async () => {
    const { data, error } = await createClient()
      .from("ai_claim_checks")
      .select("id,status,input_signature,result,model,created_at")
      .eq("claim_id", claim.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error)
      throw new Error(
        "Unable to load AI checks. Ask your administrator to check the AI setup.",
      );
    return data as SavedCheck | null;
  }, [claim.id, signature]);
  const saved = state.data;
  const stale = !!saved && saved.input_signature !== signature;
  const report = saved?.status === "complete" ? saved.result : null;
  const findings = report ? coachFindings(report, report.allocation?.claimed_amount ?? (stale ? null : Number(claim.amount).toFixed(2)), stale ? null : receiptPlan) : [];
  const reviewGroups = reviewFindingGroups(findings);
  const activityUseFlagged = findings.some(finding => finding.title === "Explain activity use");
  const matchingCount = report ? Number(report.amount_status === "match") + Number(report.date_status === "match") + Number(report.purpose_clear && !activityUseFlagged) : 0;
  const checking = busy || (saved?.status === "running" && now - Date.parse(saved.created_at) < 180000);
  const reload = state.reload;
  useEffect(() => {
    if (saved?.status !== "running") return;
    const interval = window.setInterval(() => { setNow(Date.now()); reload(); }, 4000);
    return () => window.clearInterval(interval);
  }, [saved?.status, reload]);
  const canRun =
    ["draft", "submitted", "needs_info", "rejected"].includes(claim.status) &&
    attachments.some((a) => a.kind === "receipt");
  async function run() {
    if (checking || !consent) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    notify({ title: "Checking your claim…", description: "Reading the receipts and comparing the details. This may take a minute.", tone: "progress" });
    try {
      const response = await fetch(`/api/claims/${claim.id}/ai-check`, {
        method: "POST",
        headers: { "x-moneylai-ai-consent": "yes" },
        signal: AbortSignal.timeout(115000),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to complete AI check.");
      notify({ title: "AI check completed", description: "Next: review the findings below. Correct any issues before submitting; Treasurer makes the final decision.", href: `/claims/${claim.id}#claim-ai-check`, label: "Review AI findings" });
      state.reload();
      onChanged();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "TimeoutError"
          ? e.message
          : "The check took too long. Results will update automatically if it finishes. You can retry after 3 minutes.",
      );
      state.reload();
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  const label = {
    match: "Matches",
    mismatch: "Check needed",
    unable_to_verify: "Unable to verify",
  };
  const content = <>
      {!compact && <span className="eyebrow">GEMINI ASSISTED REVIEW</span>}
      {!compact && <h2>{claim.claimant_id === user?.id ? "Claim readiness coach" : "Receipt & claim cross-check"}</h2>}
      {!compact && !reviewer && <div className="ai-workspace-steps" aria-label="AI check steps">
        <span
          className={
            attachments.some((a) => a.kind === "receipt") ? "active" : ""
          }
        >
          01 / Attach receipts
        </span>
        <span className={busy ? "active" : ""}>02 / Analyse</span>
        <span className={report && !stale ? "active" : ""}>
          03 / Review findings
        </span>
      </div>}
      {busy && (
        <div className="ai-working" role="status">
          <span className="spinner" />
          Reading receipt data and comparing your claim…
        </div>
      )}
      {!report && <p>Compare your claim with the receipts before submitting.</p>}
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {stale && (
        <Notice>
          Outdated — the claim or attachments changed. Run a new check before
          using these findings.
        </Notice>
      )}
      {saved?.status === "running" && (
        <Notice>
          Checking receipts. Results update automatically. If the check was interrupted, you can retry after 3 minutes.
        </Notice>
      )}
      {saved?.status === "failed" && (
        <Notice>
          The last check did not complete. You can retry later or continue with
          manual review.
        </Notice>
      )}
      {report && (
        <div className={styles.report}>
          <h3>{stale ? "Previous check" : `${matchingCount} ${matchingCount === 1 ? "check matches" : "checks match"} · ${findings.length} ${findings.length === 1 ? "point" : "points"} to check`}</h3>
          <dl className={styles.checks}>
            <div><dt>Amount</dt><dd className={report.amount_status === "match" ? styles.match : styles.caution}>
              {report.amount_status === "match" ? "✓ " : "! "}{label[report.amount_status]}
              {report.amount_status === "match" && ` · ${money(report.allocation?.expected_amount ?? report.receipt_total ?? claim.amount)}`}
            </dd></div>
            <div><dt>Date</dt><dd className={report.date_status === "match" ? styles.match : styles.caution}>
              {report.date_status === "match" ? "✓ " : "! "}{label[report.date_status]}
              {report.date_status === "match" && ` · ${report.receipts[0]?.date ?? "Date unavailable"}`}
            </dd></div>
            <div><dt>Purpose</dt><dd className={report.purpose_clear && !activityUseFlagged ? styles.match : styles.caution}>
              {report.purpose_clear ? activityUseFlagged ? "ℹ Description is clear; activity use needs checking" : "✓ Description is clear" : "! Add an explanation"}
            </dd></div>
          </dl>
          {!reviewer && findings.length > 0 && <div className={styles.findings}>
            <h4>{stale ? "Points from the previous check" : reviewer ? "Points to check" : "Please check before submitting"}</h4>
            {findings.map((finding, i) => <article className={styles.finding} key={i}>
              <strong>{finding.title}</strong>
              <p>{finding.evidence}</p>
              <p className={styles.next}>{finding.next}</p>
              {!stale && claim.claimant_id === user?.id && claim.status === "draft" && finding.action !== "review" && (finding.action === "edit" ? onEditDetails ? <button type="button" className="text-button" onClick={onEditDetails}>Edit claim details →</button> : <Link href={`/claims/${claim.id}/edit`}>Edit claim details →</Link> : onEditReceipt ? <button type="button" className="text-button" onClick={onEditReceipt}>Update receipt →</button> : <a href="#supporting-documents">Update receipt files →</a>)}
            </article>)}
          </div>}
          <p className={styles.disclaimer}>AI suggestions only. Final approval is by the Treasurer.</p>
          {report.receipts.map(r => {
            const attachment = attachments.find(a => a.id === r.attachment_id);
            return <article className={styles.receipt} key={r.attachment_id}>
              <div className={styles.receiptHeader}>
                <strong>{r.merchant ?? "Merchant unknown"} · {r.currency ?? "Currency unknown"} {r.amount ?? "Amount unknown"} · {r.date ?? "Date unknown"}</strong>
                {attachment && <FileLink bucket="receipts" path={attachment.storage_path} label="View receipt" />}
              </div>
              <span className={r.readable ? styles.match : styles.caution}>{r.readable ? "✓ Receipt readable" : "! Needs a clearer copy"}</span>
            </article>;
          })}
          <small>Checked {dateTime(saved!.created_at)}</small>
          <details className={styles.details}>
            <summary>Check details</summary>
            <dl>
              <dt>Receipt total read by AI</dt><dd>{report.receipt_total === null ? "Unable to verify" : money(report.receipt_total)}</dd>
              <dt>Claim amount at check</dt><dd>{report.allocation ? money(report.allocation.claimed_amount) : stale ? "See the previous claim details" : money(claim.amount)}</dd>
              {report.allocation && <><dt>Receipt comparison amount</dt><dd>{money(report.allocation.expected_amount)}</dd><dt>Difference</dt><dd>{money(report.allocation.difference)}</dd></>}
              <dt>Purpose assessment</dt><dd>{report.purpose_note}</dd>
            </dl>
            {report.allocation && <p>{report.allocation.method === "full" ? "Full receipt claims are compared with a fresh reading of the final paid total." : "Partial claims use the item allocation and may differ from the full receipt total."}</p>}
            {report.receipts.map(r => <p key={r.attachment_id}><b>{attachments.find(a => a.id === r.attachment_id)?.original_name ?? "Previous receipt"}</b>{r.note ? ` — ${r.note}` : ""}</p>)}
            <small>Model: {saved!.model}</small>
          </details>
        </div>
      )}
      {canRun && (
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={checking}
          />
          Send receipts, purpose and category to Google Gemini. Supporting files and bank details are excluded.
        </label>
      )}
      <div className="form-actions">
        <button
          type="button"
          className={compact ? "button secondary" : "button primary"}
          disabled={!canRun || !consent || checking || state.loading}
          onClick={run}
        >
          {checking
            ? "Checking receipts…"
            : saved
              ? "Run again"
              : "Run AI check"}
        </button>
      </div>
      {!canRun && (
        <p>{reviewer ? "AI checks can be run while the claim is awaiting review and has a receipt. You can review the originals manually." : "Upload a receipt and run the check before the claim is approved."}</p>
      )}
      <small>
        AI unavailable? You can still submit for manual review.
      </small>
    </>;
  return <section className={embedded ? styles.embedded : `panel ${styles.panel}`} id="claim-ai-check" aria-busy={busy}>
    {reviewer ? <>
      <h3>AI receipt check <small>(optional)</small></h3>
      <p>{state.loading ? "Loading saved findings…" : state.error ? "Saved findings could not be loaded. Review the original receipt manually."
        : stale ? "Saved findings are outdated. Run a new check or review the originals manually."
        : saved?.status === "running" ? "An AI check is in progress. You can still inspect the original receipt."
        : saved?.status === "failed" ? "The last AI check did not complete. Review the original or try again."
        : report ? "AI suggestions only. Check the original before approving."
        : "No AI check yet. You can review the original receipt manually."}</p>
      {report && !stale && <div className={styles.reviewSummary}>
        <span>Amount: {label[report.amount_status]}</span><span>Date: {label[report.date_status]}</span>
        <span>Purpose: {report.purpose_clear && !activityUseFlagged ? "Clear" : "Needs review"}</span>
      </div>}
      {report && !stale && reviewGroups.length > 0 && <p className={styles.reviewTopics}>Review: {reviewGroups.map(g => g.title).join(" · ")}</p>}
      <details><summary>View AI details & tools</summary>
        {report && !stale && reviewGroups.length > 0 && <div className={styles.findings}>
          {reviewGroups.map(group => <article className={styles.finding} key={group.title}>
            <strong>{group.title}</strong>
            <ul>{group.findings.map((finding, i) => <li key={i}>{finding.evidence}</li>)}</ul>
            {[...new Set(group.findings.map(f => f.next))].map(next => <p key={next}>{next}</p>)}
          </article>)}
        </div>}
        {content}
      </details>
    </> : content}
  </section>;
}
