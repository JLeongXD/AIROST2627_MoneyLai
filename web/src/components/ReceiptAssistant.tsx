"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Field, Notice } from "./UI";
import { useFeedback } from "./FeedbackProvider";
import { createClient } from "@/lib/supabase/client";
import { rpc } from "@/lib/api";
import { errorMessage, fileError, money } from "@/lib/domain";
import { calculateAllocation, initialSelection, type ReceiptExtraction, type ReceiptSelection, type ReceiptPlan, type ReceiptAssistantValue } from "@/lib/ai/receipt-allocation";
import styles from "./ReceiptAssistant.module.css";
type Duplicates = { other_matches: number; own_matches: { claim_id: string; code: string; status: string }[] };
export default function ReceiptAssistant({ activityId, initialPlan, onChange, onApply, onBusyChange }: {
  activityId: string; initialPlan: ReceiptPlan | null;
  onChange: (value: ReceiptAssistantValue | null) => void;
  onApply: (fields: { amount: string; date: string | null; category: string; description: string }) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState(initialPlan?.session_id ?? "");
  const [reading, setReading] = useState<ReceiptExtraction | null>(initialPlan?.extraction ?? null);
  const [selection, setSelection] = useState<ReceiptSelection | null>(initialPlan?.selection ?? null);
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null);
  const notify = useFeedback();
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  function change(next: ReceiptSelection) {
    setSelection(next);
    if (reading && sessionId) onChange({ sessionId, extraction: reading, selection: next });
  }
  function choose(next: File | null) {
    if (!next || busy) return;
    const issue = fileError(next) || (next.name.length > 200 ? "Rename the receipt to at most 200 characters." : null);
    if (issue) { setError(issue); return; }
    setFile(next); setPreview(URL.createObjectURL(next)); setPreviewFailed(false); setReading(null); setSelection(null); setSessionId(""); setDuplicates(null); setError(""); onChange(null);
  }
  async function read() {
    if (busy || !file || !consent) return;
    setBusy(true); onBusyChange(true); setError("");
    notify({ title: "Reading receipt…", description: "Uploading privately, then extracting receipt facts. Keep this page open.", tone: "progress" });
    try {
      let sid = sessionId;
      if (!sid) {
        const draft = await rpc<{ id: string; path: string }>("ml_create_receipt_draft", { p_activity_id: activityId, p_name: file.name, p_mime: file.type });
        const upload = await createClient().storage.from("receipt-drafts").upload(draft.path, file, { contentType: file.type, upsert: false });
        if (upload.error) throw new Error("Receipt upload failed. Check your connection and migration 013, then retry.");
        sid = draft.id; setSessionId(sid);
      }
      const response = await fetch(`/api/receipt-drafts/${sid}/extract`, { method: "POST", headers: { "x-moneylai-ai-consent": "yes" }, signal: AbortSignal.timeout(115000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not read the receipt.");
      const extracted = result.extraction as ReceiptExtraction;
      const next = initialSelection(extracted);
      setReading(extracted); setSelection(next); setDuplicates(result.duplicates);
      onChange({ sessionId: sid, extraction: extracted, selection: next });
      notify({ title: "Receipt reading ready", description: "Review every item and adjustment, explain exclusions, then confirm and apply to your form." });
    } catch (e) {
      const message = e && typeof e === "object" && "code" in e && ["PGRST202", "42P01"].includes(String(e.code))
        ? "Receipt assistance needs migration 013 in Supabase. You can continue with manual entry."
        : e instanceof Error && e.name === "TimeoutError" ? "Reading took too long. Retry to retrieve any completed reading, or use manual entry." : errorMessage(e);
      setError(message); notify({ title: "Receipt could not be read", description: message, tone: "error" });
    } finally { setBusy(false); onBusyChange(false); }
  }
  let calculation = null, issue = "";
  if (reading && selection) {
    try { calculation = calculateAllocation(reading, { ...selection, confirmed: true }); } catch (e) { issue = errorMessage(e); }
  }
  return <section className={styles.assistant} aria-label="Receipt drafting assistant" aria-busy={busy}>
    <span className="eyebrow">OPTIONAL / RECEIPT FIRST</span>
    <h3>Turn a receipt into a draft</h3>
    <p>Read one MYR receipt, select the activity purchases and confirm the calculation. AI suggestions remain editable; Treasurer makes the decision.</p>
    <div className={styles.workspace}>
      <div>
        <div className={styles.drop} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0] ?? null); }}>
          <label htmlFor="assistant-file"><strong>{file?.name ?? initialPlan?.original_name ?? "Drop a receipt here or choose a file"}</strong></label>
          <input id="assistant-file" type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy} onChange={e => choose(e.target.files?.[0] ?? null)} />
          <small>One receipt per file · JPG, PNG or PDF · up to 5 MB</small>
        </div>
        {preview && !previewFailed && (file?.type === "application/pdf" ? <iframe src={preview} title="Original receipt preview" className={styles.preview} />
          // Local user-selected preview; no image optimization or remote image request is needed.
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={preview} alt="Original receipt selected for extraction" className={styles.preview} onError={() => setPreviewFailed(true)} />)}
        {previewFailed && <Notice>The image preview is unavailable. Check that the file is a valid image, or choose another receipt.</Notice>}
        {initialPlan && !preview && <p><Link href={`/claims/${initialPlan.claim_id}#supporting-documents`}>View the original attached receipt →</Link><small>To replace it with another receipt, remove the current receipt from the claim first. Item selection supports one receipt per claim.</small></p>}
        <label className={styles.check}><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Send this receipt and selected activity context to Google Gemini. Bank details are excluded.</label>
        <button type="button" className="button secondary" disabled={busy || !file || !consent} onClick={read}>{busy ? "Reading receipt…" : "Read receipt with AI"}</button>
        {busy && <p role="status">Reading document, extracting items and checking indexed duplicates…</p>}
        <small>Temporary uploads expire for use after 24 hours; abandoned uploads are cleaned on your next extraction. Saved originals stay with the claim.</small>
      </div>
      <div>
        {error && <Notice tone="error">{error}</Notice>}
        {!reading && <Notice>Prefer manual entry? Complete the expense fields below; after saving, upload your receipt in the next step. An AI error does not block submission.</Notice>}
        {duplicates && (duplicates.other_matches > 0 || duplicates.own_matches.length > 0) && <Notice>
          <strong>Possible duplicate receipt — review before submitting.</strong>
          {duplicates.other_matches > 0 && <p>A match exists in another member’s claim. Treasurer can check the originals; private claim details are hidden.</p>}
          {duplicates.own_matches.map(m => <p key={m.claim_id}><Link href={`/claims/${m.claim_id}`}>Your claim {m.code} · {m.status}</Link></p>)}
          <small>Matches are hints; separate purchases can share details. No match does not guarantee uniqueness.</small>
        </Notice>}
        {reading && selection && <>
          <div className={styles.facts}><strong>{reading.merchant ?? "Merchant unclear"}</strong><span>{reading.currency ?? "Currency unclear"} {reading.total ?? "Total unclear"} · {reading.date ?? "Date unclear"}</span><small>{reading.document_type.replaceAll("_", " ")} · payment {reading.payment_status}{reading.receipt_number ? ` · ${reading.receipt_number}` : ""}</small></div>
          {(!reading.readable || reading.document_type !== "receipt" || reading.payment_status !== "paid") && <Notice>Evidence needs review: {reading.document_type.replaceAll("_", " ")}, payment {reading.payment_status}, {reading.readable ? "readable" : "not reliably readable"}. Confirm payment evidence; this is not a finding of fraud.</Notice>}
          {reading.warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}
          <p><b>Choose activity items.</b> Nothing is automatically excluded. Confirm each flagged item’s purpose.</p>
          <div className={styles.items}>{reading.items.map((item, index) => {
            const row = selection.items[index];
            const update = (patch: Partial<typeof row>) => change({ ...selection, confirmed: false, items: selection.items.map((r, i) => i === index ? { ...r, ...patch } : r) });
            return <article className={styles.item} key={item.id}>
              <label className={styles.check}><input type="checkbox" checked={row.included} onChange={e => { const included = e.target.checked; change({ ...selection, confirmed: false, mode: included ? selection.mode : "manual", items: selection.items.map((r, i) => i === index ? { ...r, included } : r) }); }} /><strong>{item.description}</strong></label>
              <small>AI line total: {item.amount ?? "unknown"}{item.quantity ? ` · quantity ${item.quantity}` : ""}</small>
              {item.relevance === "needs_confirmation" && <p className={styles.flag}>Confirm activity purpose: {item.reason}</p>}
              <Field label={`Confirmed line total (RM) — item ${index + 1}`} id={`line-${index}`}><input id={`line-${index}`} inputMode="decimal" value={row.amount} onChange={e => update({ amount: e.target.value })} /></Field>
              {(item.relevance === "needs_confirmation" || !row.included || row.reason) && <Field label={row.included ? "Activity purpose / note" : "Why is this item excluded?"} id={`line-reason-${index}`}><input id={`line-reason-${index}`} maxLength={1000} value={row.reason} onChange={e => update({ reason: e.target.value })} /></Field>}
            </article>;
          })}</div>
          <Field label="Confirmed full receipt total (RM)" id="confirmed-receipt-total"><input id="confirmed-receipt-total" inputMode="decimal" value={selection.receipt_total} onChange={e => change({ ...selection, confirmed: false, receipt_total: e.target.value })} /></Field>
          <Field label="Tax, discount & rounding allocation" id="allocation-mode"><select id="allocation-mode" value={selection.mode} onChange={e => change({ ...selection, confirmed: false, mode: e.target.value as ReceiptSelection["mode"] })}><option value="proportional">Use reconciled receipt amounts / proportional share</option><option value="manual">Enter allocated adjustments manually</option></select></Field>
          <small>Proportional allocation is only suitable when adjustments apply uniformly. Tax already included in line prices must not be added again.</small>
          {selection.mode === "manual" && <div className={styles.adjustments}>{(["tax", "discount", "rounding"] as const).map(key => <Field key={key} label={`Allocated ${key} (RM)`} id={`allocated-${key}`}><input id={`allocated-${key}`} inputMode="decimal" value={selection[key]} onChange={e => change({ ...selection, confirmed: false, [key]: e.target.value })} /></Field>)}</div>}
          <Field label="Explain adjustment allocation" id="adjustment-reason"><textarea id="adjustment-reason" rows={2} maxLength={1000} value={selection.adjustment_reason} onChange={e => change({ ...selection, confirmed: false, adjustment_reason: e.target.value })} placeholder="e.g. Line prices include tax; no extra adjustments are claimed." /></Field>
          <Field label="Explain any correction to AI amounts" id="correction-reason"><textarea id="correction-reason" rows={2} maxLength={1000} value={selection.correction_reason} onChange={e => change({ ...selection, confirmed: false, correction_reason: e.target.value })} placeholder="Required if you correct a line amount or the receipt total." /></Field>
          {issue && <Notice>{issue}</Notice>}
          {calculation && <div className={styles.total}><small>Calculated reimbursement</small><strong>{money(calculation.expected_amount)}</strong><span>Items {money(calculation.selected_subtotal)} + tax {money(calculation.tax)} − discount {money(calculation.discount)} + rounding {money(calculation.rounding)}</span><small>Excluded items: {money(calculation.excluded_subtotal)}</small></div>}
          <label className={styles.check}><input type="checkbox" checked={selection.confirmed} onChange={e => change({ ...selection, confirmed: e.target.checked })} />I checked the original receipt, item purposes and adjustment method.</label>
          <p><small>Applying replaces amount, purchase date, category and description below with these suggestions. Review them before saving.</small></p>
          <button type="button" className="button primary" disabled={!calculation || !selection.confirmed} onClick={() => {
            if (!calculation) return;
            onApply({ amount: calculation.expected_amount, date: reading.date, category: reading.suggested_category, description: reading.suggested_description });
            notify({ title: "Receipt suggestions applied", description: "Review the editable expense fields below, then save your draft and original receipt." });
          }}>Apply to editable fields ↓</button>
          {!initialPlan && <p><button type="button" className="text-button" onClick={() => { setReading(null); setSelection(null); onChange(null); notify({ title: "Manual entry selected", description: "Complete the fields below. You will upload a receipt after saving the draft." }); }}>Continue with manual entry instead</button></p>}
        </>}
      </div>
    </div>
  </section>;
}
