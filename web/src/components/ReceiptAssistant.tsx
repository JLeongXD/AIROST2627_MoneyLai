"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Field, Notice } from "./UI";
import { useFeedback } from "./FeedbackProvider";
import { createClient } from "@/lib/supabase/client";
import { rpc } from "@/lib/api";
import { errorMessage, fileError, money } from "@/lib/domain";
import { calculateAllocation, initialSelection, automaticReceiptAllocation, editableReceiptSelection, receiptItemReasonError, receiptItemTotals, confirmSelectedItemAmount, decimal, sen, type ReceiptExtraction, type ReceiptSelection, type ReceiptPlan, type ReceiptAssistantValue } from "@/lib/ai/receipt-allocation";
import styles from "./ReceiptAssistant.module.css";
import BudgetNotice from "./BudgetNotice";
import type { Money } from "@/lib/types";
type Duplicates = { other_matches: number; own_matches: { claim_id: string; code: string; status: string }[] };
export default function ReceiptAssistant({ activityId, availableBudget, initialPlan, onChange, onBusyChange, onFileChange, existingReceiptCount = 0, existingAttachmentCount = 0 }: {
  activityId: string; availableBudget?: Money; initialPlan: ReceiptPlan | null;
  onChange: (value: ReceiptAssistantValue | null) => void;
  onBusyChange: (busy: boolean) => void;
  onFileChange?: (file: File | null) => void;
  existingReceiptCount?: number;
  existingAttachmentCount?: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ title: "Reading receipt…", description: "" });
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(initialPlan?.session_id ?? "");
  const [reading, setReading] = useState<ReceiptExtraction | null>(initialPlan?.extraction ?? null);
  const [selection, setSelection] = useState<ReceiptSelection | null>(initialPlan ? editableReceiptSelection(initialPlan.extraction, initialPlan.selection) : null);
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null);
  const notify = useFeedback();
  const receiptName = file?.name ?? initialPlan?.original_name;
  const fileSelectionDisabled = busy || existingAttachmentCount >= 5 || Boolean(initialPlan && existingReceiptCount);
  useEffect(() => () => clearTimeout(progressTimer.current), []);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  function change(next: ReceiptSelection) {
    setSelection(next);
    if (reading && sessionId) onChange({ sessionId, extraction: reading, selection: next });
  }
  function changeScope(mode: "full" | "simple") {
    if (!reading || !selection) return;
    const next = initialSelection(reading, mode);
    change({ ...next, items: next.items.map(row => ({ ...row, reason: selection.items.find(i => i.id === row.id && i.included)?.reason ?? "" })) });
  }
  function choose(next: File | null) {
    if (!next || fileSelectionDisabled) return;
    const issue = fileError(next) || (next.name.length > 200 ? "Rename the receipt to at most 200 characters." : null);
    if (issue) { setError(issue); return; }
    setFile(next); onFileChange?.(next); setPreview(URL.createObjectURL(next)); setPreviewFailed(false); setPreviewOpen(false); setReading(null); setSelection(null); setSessionId(""); setDuplicates(null); setError(""); onChange(null);
  }
  async function read() {
    if (busy || !file || !consent) return;
    setBusy(true); onBusyChange(true); setError("");
    function reportProgress(title: string, description: string) {
      clearTimeout(progressTimer.current);
      setProgress({ title, description });
      notify({ title, description, tone: "progress" });
      progressTimer.current = setTimeout(() => {
        const waiting = "Still working—this may take a moment. Keep this page open.";
        setProgress({ title, description: waiting });
        notify({ title, description: waiting, tone: "progress" });
      }, 20000);
    }
    try {
      let sid = sessionId;
      if (!sid) {
        reportProgress("Uploading receipt…", "Uploading your receipt privately. Keep this page open.");
        const draft = await rpc<{ id: string; path: string }>("ml_create_receipt_draft", { p_activity_id: activityId, p_name: file.name, p_mime: file.type });
        const upload = await createClient().storage.from("receipt-drafts").upload(draft.path, file, { contentType: file.type, upsert: false });
        if (upload.error) throw new Error("Receipt upload failed. Check your connection and migration 013, then retry.");
        sid = draft.id; setSessionId(sid);
      }
      reportProgress("Reading receipt…", "Extracting receipt details and checking for duplicates. Keep this page open.");
      const response = await fetch(`/api/receipt-drafts/${sid}/extract`, { method: "POST", headers: { "x-moneylai-ai-consent": "yes" }, signal: AbortSignal.timeout(115000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read the receipt.");
      const extracted = result.extraction as ReceiptExtraction;
      const next = initialSelection(extracted);
      setReading(extracted); setSelection(next); setDuplicates(result.duplicates);
      onChange({ sessionId: sid, extraction: extracted, selection: next });
      notify({ title: "Receipt ready", description: "Choose full receipt or selected items, check the total, then continue." });
      requestAnimationFrame(() => { const result = document.getElementById("assistant-results"); result?.focus(); result?.scrollIntoView({ block: "start", behavior: "smooth" }); });
    } catch (e) {
      const message = e && typeof e === "object" && "code" in e && ["PGRST202", "42P01"].includes(String(e.code))
        ? "Receipt assistance needs migration 013 in Supabase. You can continue with manual entry."
        : e instanceof Error && e.name === "TimeoutError" ? "Reading took too long. Retry to retrieve any completed reading, or use manual entry." : errorMessage(e);
      setError(message); notify({ title: "Receipt could not be read", description: message, tone: "error" });
    } finally { clearTimeout(progressTimer.current); setBusy(false); onBusyChange(false); }
  }
  let calculation = null, issue = "", automaticIssue = "";
  let automatic = null;
  if (reading && selection?.mode === "simple") {
    try { automatic = automaticReceiptAllocation(reading, selection); } catch (e) { automaticIssue = errorMessage(e); }
  }
  if (reading && selection) {
    try { calculation = calculateAllocation(reading, { ...selection, confirmed: true }); } catch (e) { issue = errorMessage(e); }
  }
  const itemTotals = selection ? receiptItemTotals(selection.items) : null;
  const canConfirmItemTotal = itemTotals !== null && itemTotals.selected > 0 && (sen(selection?.receipt_total) ?? 0) > 0;
  const correctedAmount = sen(selection?.claimed_amount), originalTotal = sen(reading?.total);
  const automaticAmount = automatic ? sen(automatic.expected_amount) : null;
  const budgetAmount = selection?.claimed_amount ?? automatic?.expected_amount ?? (selection?.mode === "full" ? selection.receipt_total : undefined);
  return <section className={styles.assistant} aria-label="Receipt drafting assistant" aria-busy={busy}>
    <div className={styles.workspace}>
      <div>
        <div className={`${styles.drop} ${receiptName ? styles.hasFile : ""}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0] ?? null); }}>
          <div className={styles.fileRow}>
            <strong>{receiptName ?? (existingReceiptCount ? "Add another receipt" : "Choose or drop a receipt")}</strong>
            <div className={styles.fileActions}>
              {preview && !previewFailed && <button type="button" className="text-button" aria-expanded={previewOpen} aria-controls="receipt-preview" onClick={() => setPreviewOpen(open => !open)}>{previewOpen ? "Hide preview" : "Preview"}</button>}
              <button id="assistant-file" type="button" className={receiptName ? "text-button" : "button secondary"} disabled={fileSelectionDisabled} onClick={() => fileInput.current?.click()}>{receiptName ? "Change" : "Choose file"}</button>
            </div>
          </div>
          <input ref={fileInput} id="receipt-file-input" type="file" hidden aria-label="Choose receipt file" accept="image/jpeg,image/png,application/pdf" disabled={fileSelectionDisabled} onChange={e => { choose(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <small>JPG, PNG or PDF · max 5 MB each</small>
          {initialPlan && existingReceiptCount > 0 && <small>To replace this receipt, remove it above first.</small>}
          {existingAttachmentCount >= 5 && <small>Five files already attached. Remove a file before adding another.</small>}
          {preview && !previewFailed && <div id="receipt-preview" hidden={!previewOpen}>{file?.type === "application/pdf" ? <iframe src={preview} title="Original receipt preview" className={styles.preview} />
            // Local user-selected preview; no remote image request is needed.
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={preview} alt="Original receipt selected for extraction" className={styles.preview} onError={() => setPreviewFailed(true)} />}</div>}
        </div>
        {previewFailed && <Notice>The image preview is unavailable. Check that the file is a valid image, or choose another receipt.</Notice>}
        <section className={styles.aiPanel} aria-labelledby="receipt-ai-heading">
          <div className={styles.aiHeader}><h3 id="receipt-ai-heading">Fill details with AI</h3><span>Optional</span></div>
          <label className={styles.check}><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Send this receipt and selected activity context to Google Gemini. Bank details are excluded.</label>
          <button type="button" className={`button secondary ${busy ? styles.busyButton : ""}`} aria-busy={busy} disabled={busy || !file || !consent || existingReceiptCount > 0} onClick={read}>{busy ? <><span className="loading-spinner loading-spinner-small" aria-hidden="true" />{progress.title}</> : error ? "Retry reading receipt" : "Read receipt with AI"}</button>
          {existingReceiptCount > 0 && <small>AI item selection uses one receipt. Review the saved selection below, or continue manually.</small>}
          {busy && <p role="status">{progress.description}</p>}
        </section>
      </div>
      <div>
        {error && <Notice tone="error">{error}</Notice>}
        {duplicates && (duplicates.other_matches > 0 || duplicates.own_matches.length > 0) && <Notice>
          <strong>Possible duplicate receipt — review before submitting.</strong>
          {duplicates.other_matches > 0 && <p>A match exists in another member’s claim. Treasurer can check the originals; private claim details are hidden.</p>}
          {duplicates.own_matches.map(m => <p key={m.claim_id}><Link href={`/claims/${m.claim_id}`}>Your claim {m.code} · {m.status}</Link></p>)}
          <small>Treasurer will verify the originals.</small>
        </Notice>}
        {reading && selection && <>
          <div className={styles.facts} id="assistant-results" tabIndex={-1}><strong>{reading.merchant ?? "Merchant unclear"}</strong><span>{reading.currency ?? "Currency unclear"} {reading.total ?? "Total unclear"} · {reading.date ?? "Date unclear"}</span><small>{reading.document_type.replaceAll("_", " ")} · payment {reading.payment_status}{reading.receipt_number ? ` · ${reading.receipt_number}` : ""}</small></div>
          {(!reading.readable || reading.document_type !== "receipt" || reading.payment_status !== "paid") && <Notice>Evidence needs review: {reading.document_type.replaceAll("_", " ")}, payment {reading.payment_status}, {reading.readable ? "readable" : "not reliably readable"}. Confirm payment evidence; this is not a finding of fraud.</Notice>}
          {reading.warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}
          <fieldset className={styles.scope}><legend>What are you claiming?</legend>
            <label><input type="radio" name="receipt-scope" checked={selection.mode === "full"} onChange={() => changeScope("full")} /><span>Full receipt — all purchases are for this activity</span></label>
            <label><input type="radio" name="receipt-scope" checked={selection.mode !== "full"} onChange={() => changeScope("simple")} /><span>Selected items only</span></label>
          </fieldset>
          {selection.mode === "full" ? <>
            <Field label="Final paid receipt total (RM)" id="full-receipt-total"><input id="full-receipt-total" inputMode="decimal" value={selection.receipt_total} onChange={e => change({ ...selection, receipt_total: e.target.value, confirmed: false })} /></Field>
            <p>Use Grand Total. Charges and discounts are already included; nothing is added again.</p>
            {reading.total === null && <Notice>AI could not read the total. Enter it from the original.</Notice>}
            {reading.total !== null && Number(reading.total) !== Number(selection.receipt_total) && <Field label="Why did you correct the AI total?" id="full-correction"><textarea id="full-correction" rows={2} maxLength={1000} value={selection.correction_reason} onChange={e => change({ ...selection, correction_reason: e.target.value, confirmed: false })} /></Field>}
          </> : <p><b>Select the activity purchases.</b> Uncheck purchases you are not claiming.</p>}
          {!!reading.items.length && <p>Enter an activity purpose for every claimed item and a reason for every excluded item. Your answers will form the purpose on the next page.</p>}
          <div className={styles.items}>{reading.items.map((item, index) => {
            const row = selection.items[index];
            const reasonError = receiptItemReasonError(reading, selection, index);
            const update = (patch: Partial<typeof row>) => change({ ...selection, confirmed: false, items: selection.items.map((r, i) => i === index ? { ...r, ...patch } : r) });
            return <article className={styles.item} key={item.id}>
              <label className={styles.check}><input type="checkbox" checked={row.included} disabled={selection.mode === "full"} onChange={e => { const included = e.target.checked; change({ ...selection, confirmed: false, claimed_amount: undefined, override_reason: "", mode: selection.mode, items: selection.items.map((r, i) => i === index ? { ...r, included, reason: "" } : r) }); }} /><strong>{item.description}</strong></label>
              {row.included && item.relevance === "needs_confirmation" && <p className={styles.flag}>Confirm activity purpose: {item.reason}</p>}
              <strong>{row.amount ? money(row.amount) : "Amount unclear"}</strong>
              <Field label={row.included ? "How is this item used for the activity? (Required)" : "Why is this item excluded? (Required)"} id={`line-reason-${index}`}><input id={`line-reason-${index}`} required minLength={3} maxLength={1000} aria-required="true" aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? `line-reason-error-${index}` : undefined} placeholder={row.included ? "Describe its use in this activity" : "Explain why this purchase is not being claimed"} value={row.reason} onChange={e => update({ reason: e.target.value })} />
                {reasonError && <small id={`line-reason-error-${index}`} role="alert">{reasonError}</small>}
              </Field>
              {row.included && row.reason.trim().length >= 3 && selection.items.some((r, i) => i !== index && r.included && !r.reason.trim()) && <button type="button" className="text-button" onClick={() => change({ ...selection, confirmed: false, items: selection.items.map((r, i) => i !== index && r.included && !r.reason.trim() ? { ...r, reason: row.reason.trim() } : r) })}>Apply this purpose to other selected items without a purpose</button>}
            </article>;
          })}</div>
          {selection.mode !== "full" && <>
          <p>Selected share · {(() => {
            if (!itemTotals) return "Item amounts unclear";
            const all = itemTotals.selected + itemTotals.excluded;
            return all ? `${money(decimal(itemTotals.selected))} / ${money(decimal(all))} · ${(itemTotals.selected / all * 100).toFixed(1)}%` : "Check the original";
          })()}</p>
          {automaticIssue && <Notice><strong>Automatic calculation needs review.</strong> {automaticIssue}
            {selection.claimed_amount === undefined && <p>Check the original, then confirm the selected item total below or enter a different reimbursement amount.</p>}
          </Notice>}
          {automaticIssue && selection.claimed_amount === undefined && canConfirmItemTotal && itemTotals && <>
            <p>Selected item total: {money(decimal(itemTotals.selected))}. No extra adjustments will be claimed. Treasurer will see this as your confirmed amount.</p>
            <button type="button" className="button secondary" onClick={() => change(confirmSelectedItemAmount(selection))}>Use {money(decimal(itemTotals.selected))} — I confirm this amount</button>
          </>}
          {automatic && <div className={styles.facts}>
            <strong>Automatic reimbursement: {money(automatic.expected_amount)}</strong>
            {Number(automatic.tax) > 0 && selection.items.some(i => !i.included) && <small>Receipt-level tax is allocated across all items in proportion to their amounts by default.</small>}
            {(["tax", "discount", "rounding"] as const).filter(k => Number(automatic[k]) !== 0).map(k => <span key={k}>Receipt {k} {money(reading[k])} × selected share = {money(automatic[k])}{k === "discount" ? " deducted" : ""}</span>)}
            {(["tax", "discount", "rounding"] as const).every(k => Number(automatic[k]) === 0) && <small>No extra adjustments applied. Included amounts are not counted twice.</small>}
          </div>}
          <button type="button" className="text-button" onClick={() => change({ ...selection, confirmed: false, claimed_amount: selection.claimed_amount === undefined ? automatic?.expected_amount ?? (canConfirmItemTotal && itemTotals ? decimal(itemTotals.selected) : "") : undefined, override_reason: "" })}>{selection.claimed_amount === undefined ? "Change reimbursement amount" : automatic ? "Use automatic amount" : "Reset confirmed amount"}</button>
          {selection.claimed_amount !== undefined && <>
            <Notice><strong>Member-corrected amount · pending Treasurer review.</strong> This is your confirmed amount, not an AI-verified calculation. Treasurer will see the original calculation and your reason.</Notice>
            <Field label="This reimbursement amount (RM)" id="reimbursement-amount"><input id="reimbursement-amount" inputMode="decimal" value={selection.claimed_amount} onChange={e => change({ ...selection, confirmed: false, claimed_amount: e.target.value, override_reason: "" })} /></Field>
            <Field label="Why did you change or manually confirm this amount?" id="override-reason"><textarea id="override-reason" rows={2} maxLength={1000} value={selection.override_reason ?? ""} onChange={e => change({ ...selection, confirmed: false, override_reason: e.target.value })} /></Field>
            {correctedAmount !== null && correctedAmount > 0 && <div className={styles.facts}>
              <span>AI-read receipt total: {originalTotal === null ? "Unclear" : money(decimal(originalTotal))}</span>
              <span>Automatic reimbursement: {automaticAmount === null ? "Unverified" : money(decimal(automaticAmount))}</span>
              <strong>Member-confirmed reimbursement: {money(decimal(correctedAmount))}</strong>
              {automaticAmount !== null && <span>Difference from automatic calculation: {correctedAmount > automaticAmount ? "+" : ""}{money(decimal(correctedAmount - automaticAmount))}</span>}
              {originalTotal !== null && correctedAmount > originalTotal && <small>This amount exceeds the AI-read receipt total by {money(decimal(correctedAmount - originalTotal))}. You can continue after entering a reason and confirming. Treasurer must verify the original.</small>}
            </div>}
          </>}
          </>}
          {issue && (!automaticIssue || selection.claimed_amount !== undefined) && <Notice>{issue}</Notice>}
          {calculation && <div className={styles.total}><small>{selection.claimed_amount !== undefined ? "Member-confirmed reimbursement" : "Reimbursement"}</small><strong>{money(calculation.expected_amount)}</strong>{selection.mode === "full" ? <small>Final paid total · no separate allocation</small> : calculation.automatic_issue ? <small>Automatic allocation is unavailable. This amount was confirmed by the member; Treasurer must verify it.</small> : <><span>Items {money(calculation.selected_subtotal)}{Number(calculation.tax) !== 0 && ` + extra tax ${money(calculation.tax)}`}{Number(calculation.discount) !== 0 && ` − extra discount ${money(calculation.discount)}`}{Number(calculation.rounding) !== 0 && ` + rounding ${money(calculation.rounding)}`}</span><small>Included charges and discounts are not applied twice. Excluded items: {money(calculation.excluded_subtotal)}</small></>}</div>}
          <BudgetNotice amount={budgetAmount} available={availableBudget} />
          <label className={styles.check}><input id="assistant-confirm" type="checkbox" checked={selection.confirmed} onChange={e => change({ ...selection, confirmed: e.target.checked })} />{selection.mode === "full" ? "I checked the final paid total and all purchases are for this activity." : "I checked the selected purchases and reimbursement amount."}</label>
          <p><button type="button" className="text-button" onClick={() => { setReading(null); setSelection(null); onChange(null); notify({ title: "Manual entry selected", description: "Choose Next to enter your expense details. Your selected receipt is kept." }); }}>Enter details myself instead</button></p>
        </>}
      </div>
    </div>
  </section>;
}
