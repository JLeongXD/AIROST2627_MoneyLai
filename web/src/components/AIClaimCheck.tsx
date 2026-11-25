"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLoad } from "@/lib/useLoad";
import { checkSignature, type SavedCheck } from "@/lib/ai/claim-check";
import type { Claim, Attachment } from "@/lib/types";
import { Notice } from "./UI";
import { dateTime, money } from "@/lib/domain";
import styles from "./AIClaimCheck.module.css";
import Link from "next/link";
import { coachFindings } from "@/lib/ai/coach";
import { useAuth } from "./AuthProvider";

export default function AIClaimCheck({
  claim,
  attachments,
  onChanged,
}: {
  claim: Claim;
  attachments: Attachment[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const signature = checkSignature(claim, attachments);
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
  const canRun =
    ["draft", "submitted", "needs_info", "rejected"].includes(claim.status) &&
    attachments.some((a) => a.kind === "receipt");
  async function run() {
    if (busy || !consent) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/claims/${claim.id}/ai-check`, {
        method: "POST",
        headers: { "x-moneylai-ai-consent": "yes" },
        signal: AbortSignal.timeout(115000),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to complete AI check.");
      state.reload();
      onChanged();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "TimeoutError"
          ? e.message
          : "The check took too long. Refresh results before trying again.",
      );
      state.reload();
    } finally {
      setBusy(false);
    }
  }
  const label = {
    match: "Matches extracted receipt data",
    mismatch: "Needs review",
    unable_to_verify: "Unable to verify",
  };
  return (
    <section className={`panel ${styles.panel}`}>
      <span className="eyebrow">GEMINI ASSISTED REVIEW</span>
      <h2>Claim readiness coach</h2>
      <div className="ai-workspace-steps" aria-label="AI check steps">
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
      </div>
      {busy && (
        <div className="ai-working" role="status">
          <span className="spinner" />
          Reading receipt data and comparing your claim…
        </div>
      )}
      <p>
        Check receipt totals, dates and whether the purpose needs clarification.
        AI findings are suggestions; Treasurer makes the final decision.
      </p>
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
          A check was started. Refresh results shortly. If it was interrupted,
          you can retry after 3 minutes.
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
          {!stale && <div className="coach-findings">
            <h3>{!report.needs_attention ? "Ready for human review" : report.amount_status === "unable_to_verify" || report.date_status === "unable_to_verify" ? "Some evidence cannot be verified" : "Information needs attention"}</h3>
            <p>These suggestions do not approve, reject or guarantee a claim.</p>
            {coachFindings(report, Number(claim.amount).toFixed(2)).map((finding, i) => <article className="coach-finding" key={i}>
              <strong>{finding.title}</strong><p>{finding.evidence}</p><p><b>Next step:</b> {finding.next}</p>
              {claim.claimant_id === user?.id && claim.status === "draft" && finding.action !== "review" && (finding.action === "edit" ? <Link href={`/claims/${claim.id}/edit`}>Edit claim details →</Link> : <a href="#supporting-documents">Update receipt files →</a>)}
            </article>)}
          </div>}
          <h3>
            {stale
              ? "Previous findings"
              : report.needs_attention
                ? "Needs attention"
                : "No discrepancies found in extracted data"}
          </h3>
          <dl>
            <dt>Amount</dt>
            <dd>
              {label[report.amount_status]}
              {report.receipt_total !== null
                ? ` · Extracted total ${money(report.receipt_total)}`
                : ""}
            </dd>
            <dt>Date</dt>
            <dd>{label[report.date_status]}</dd>
            <dt>Purpose</dt>
            <dd>
              {report.purpose_clear
                ? "Clear enough for review"
                : "Clarification suggested"}{" "}
              — {report.purpose_note}
            </dd>
          </dl>
          {report.warnings.length > 0 && (
            <ul>
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {report.receipts.map((r) => (
            <article className={styles.receipt} key={r.attachment_id}>
              <strong>
                {attachments.find((a) => a.id === r.attachment_id)
                  ?.original_name ?? "Previous receipt"}
              </strong>
              <p>
                {r.merchant ?? "Merchant unknown"} ·{" "}
                {r.currency ?? "Currency unknown"}{" "}
                {r.amount ?? "Amount unknown"} · {r.date ?? "Date unknown"}
              </p>
              <p>
                {r.readable ? "Readable" : "Needs a clearer copy"}
                {r.note ? ` — ${r.note}` : ""}
              </p>
            </article>
          ))}
          <small>
            {dateTime(saved!.created_at)} · {saved!.model}
          </small>
        </div>
      )}
      {canRun && (
        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={busy}
          />
          Send this claim’s receipt files, purpose and category to Google Gemini
          for this check. Supporting files and bank details are excluded.
        </label>
      )}
      <div className="form-actions">
        <button
          className="button primary"
          disabled={!canRun || !consent || busy || state.loading}
          onClick={run}
        >
          {busy
            ? "Checking receipts…"
            : saved
              ? "Run check again"
              : "Check my claim"}
        </button>
        <button
          className="button secondary"
          disabled={busy || state.loading}
          onClick={state.reload}
        >
          Refresh results
        </button>
      </div>
      {!canRun && (
        <p>Upload a receipt and run the check before the claim is approved.</p>
      )}
      <small>
        One receipt per file. Up to 5 files, 5 MB each and 10 MB total. You can
        still submit for manual review if AI is unavailable.
      </small>
    </section>
  );
}
