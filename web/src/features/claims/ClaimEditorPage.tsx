"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader, Loading, Notice, Field, FileLink } from "@/components/UI";
import { useAuth } from "@/components/AuthProvider";
import { useLoad } from "@/lib/useLoad";
import { getClaim, getReceiptPlan, getAttachments, getPayout, listActivities, rpc, uploadAttachment, removeAttachment } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import ReceiptAssistant from "@/components/ReceiptAssistant";
import AIClaimCheck from "@/components/AIClaimCheck";
import ReceiptAllocation from "@/components/ReceiptAllocation";
import BudgetNotice from "@/components/BudgetNotice";
import { calculateAllocation, editableReceiptSelection, receiptItemReasonError, receiptPurposeDescription, type ReceiptPlan, type ReceiptAssistantValue } from "@/lib/ai/receipt-allocation";
import { CATEGORIES, amountError, errorMessage, money, today } from "@/lib/domain";
import type { Activity, Attachment, Claim, Payout } from "@/lib/types";
import { saveClaimDraft, type DraftProgress } from "@/lib/claim-draft";
import { browserFetch } from "@/lib/browser-fetch";
import { useFeedback } from "@/components/FeedbackProvider";
import styles from "./ClaimEditorPage.module.css";

const steps = ["Activity", "Receipt", "Expense details", "Review & submit"];
export default function ClaimEditorPage({ edit = false }: { edit?: boolean }) {
  const params = useParams<{ id: string }>();
  const id = edit ? params.id : undefined;
  const { user } = useAuth();
  const state = useLoad(async () => {
    const [activities, claim, plan, attachments, payout] = await Promise.all([
      listActivities(), id ? getClaim(id) : null, id ? getReceiptPlan(id) : null,
      id ? getAttachments(id) : [], getPayout(user!.id),
    ]);
    let question = "";
    if (claim?.info_requested_at) {
      const result = await createClient().from("claim_clarifications").select("question").eq("claim_id", claim.id).is("responded_at", null).order("requested_at", { ascending: false }).limit(1).single();
      if (result.error) throw new Error("Could not load the Treasurer’s question. Please retry.");
      question = result.data.question;
    }
    const query = new URLSearchParams(window.location.search);
    return { activities, claim, plan, attachments, payout, question, initialActivity: query.get("activity") ?? "",
      initialStep: query.get("step") === "receipt" ? 2 : query.get("step") === "review" && claim?.purchase_date && attachments.some(a => a.kind === "receipt") ? 4 : claim ? 3 : 1 };
  }, [id, user?.id]);
  if (state.loading) return <Loading />;
  if (state.error) return <Notice tone="error">{state.error} <button className="button secondary" onClick={state.reload}>Try again</button></Notice>;
  if (!state.data) return null;
  const data = state.data;
  if (data.claim && (data.claim.claimant_id !== user?.id || data.claim.status !== "draft"))
    return <Notice>This claim is no longer an editable draft. <Link href={`/claims/${id}`}>View claim status →</Link></Notice>;
  return <div className={styles.page}>
    <PageHeader title={edit ? "Continue your claim" : "New claim"} description="" />
    <ClaimForm key={id ?? "new"} claim={data.claim} activities={data.activities} initialActivity={data.initialActivity}
      initialPlan={data.plan} initialAttachments={data.attachments} payout={data.payout} question={data.question} initialStep={data.initialStep} />
  </div>;
}
export function ClaimForm({ claim, activities, initialActivity, initialPlan = null, initialAttachments = [], payout = null, question = "", initialStep = claim ? 3 : 1 }: {
  claim: Claim | null; activities: Activity[]; initialActivity: string; initialPlan?: ReceiptPlan | null;
  initialAttachments?: Attachment[]; payout?: Payout | null; question?: string; initialStep?: number;
}) {
  const router = useRouter(), notify = useFeedback();
  const usableInitialPlan = initialPlan && initialAttachments.filter(a => a.kind === "receipt").length === 1 && initialAttachments.some(a => a.id === initialPlan.attachment_id) ? initialPlan : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const progress = useRef<DraftProgress>({ id: claim?.id ?? null, uploadedFile: null, revision: initialPlan?.revision ?? 0 });
  const appliedSelection = useRef(usableInitialPlan ? JSON.stringify({ sessionId: usableInitialPlan.session_id, selection: editableReceiptSelection(usableInitialPlan.extraction, usableInitialPlan.selection) }) : "");
  const [step, setStep] = useState(usableInitialPlan && !["full", "simple"].includes(usableInitialPlan.selection.mode) && initialStep !== 4 ? 2 : initialStep);
  const [activityId, setActivityId] = useState(claim?.activity_id ?? initialActivity);
  const [amount, setAmount] = useState(String(claim?.amount ?? ""));
  const [description, setDescription] = useState(claim?.description ?? "");
  const [generatedPurpose, setGeneratedPurpose] = useState<string | null>(null);
  const [purposeNeedsReview, setPurposeNeedsReview] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(claim?.purchase_date ?? today());
  const [category, setCategory] = useState(claim?.category ?? "Materials");
  const [file, setFile] = useState<File | null>(null);
  const [assisted, setAssisted] = useState<ReceiptAssistantValue | null>(usableInitialPlan ? { sessionId: usableInitialPlan.session_id, extraction: usableInitialPlan.extraction, selection: usableInitialPlan.selection } : null);
  const [plan, setPlan] = useState(initialPlan), [savedClaim, setSavedClaim] = useState(claim);
  const [savedId, setSavedId] = useState<string | null>(claim?.id ?? null);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [reply, setReply] = useState(""), [busy, setBusy] = useState(false), [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState(""), [dirty, setDirty] = useState(false);
  const [receiptVersion, setReceiptVersion] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => setKeyboardOpen(Boolean(viewport && window.innerHeight - viewport.height > 160));
    viewport?.addEventListener("resize", update);
    return () => viewport?.removeEventListener("resize", update);
  }, []);
  const selected = activities.find(a => a.id === activityId);
  const receipts = attachments.filter(a => a.kind === "receipt");
  const usablePlan = plan && receipts.length === 1 && receipts.some(a => a.id === plan.attachment_id) ? plan : null;
  const needsReply = Boolean(claim?.info_requested_at);
  function go(next: number) {
    setStep(next); setError("");
    requestAnimationFrame(() => { heading.current?.focus(); heading.current?.scrollIntoView({ block: "start", behavior: "smooth" }); });
  }
  function fail(message: string, field?: string) {
    setError(message);
    requestAnimationFrame(() => {
      const target = field ? document.getElementById(field) : document.getElementById("claim-flow-error");
      target?.focus(); target?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
  function apply(fields: { amount: string; date: string | null; category: string; description: string }) {
    appliedSelection.current = assisted ? JSON.stringify({ sessionId: assisted.sessionId, selection: assisted.selection }) : "";
    setAmount(fields.amount); setPurchaseDate(fields.date ?? ""); setCategory(fields.category);
    if (!description.trim() || description === generatedPurpose) {
      setDescription(fields.description); setPurposeNeedsReview(false);
    } else setPurposeNeedsReview(description !== fields.description);
    setGeneratedPurpose(fields.description); setDirty(true); go(3);
  }
  async function persist() {
    if (selected?.status !== "active") throw new Error("Choose an active activity before saving.");
    const issue = amountError(amount);
    if (issue) { fail(issue, "amount"); return null; }
    if (!purchaseDate || purchaseDate > today()) { fail("Enter a valid purchase date.", "purchase-date"); return null; }
    if (!description.trim() || description.trim().length > 500) { fail("Describe what this purchase was for.", "description"); return null; }
    if (assisted) calculateAllocation(assisted.extraction, assisted.selection);
    let result;
    try { result = await saveClaimDraft({ activityId, amount, description, purchaseDate, category }, file, assisted, progress.current, {
      rpc, fetch: browserFetch, upload: uploadAttachment, claim: getClaim, attachments: getAttachments, plan: getReceiptPlan,
    }); } finally { setSavedId(progress.current.id); }
    setSavedClaim(result.claim); setAttachments(result.attachments); setPlan(result.plan); setDirty(false);
    return result;
  }
  async function advance(event: FormEvent) {
    event.preventDefault(); if (busy || aiBusy) return;
    if (step === 1) {
      if (selected?.status !== "active") return fail("Choose an activity to continue.", "activity");
      go(2); return;
    }
    if (step === 2) {
      if (!file && !receipts.length) return fail("Add a receipt to continue.", "assistant-file");
      if (assisted) {
        try {
          const missing = assisted.selection.items.findIndex((_, index) => receiptItemReasonError(assisted.extraction, assisted.selection, index));
          if (missing >= 0) return fail(receiptItemReasonError(assisted.extraction, assisted.selection, missing)!, `line-reason-${missing}`);
          const total = calculateAllocation(assisted.extraction, assisted.selection);
          if (appliedSelection.current === JSON.stringify({ sessionId: assisted.sessionId, selection: assisted.selection })) { go(3); return; }
          apply({ amount: total.expected_amount, date: assisted.extraction.date, category: assisted.extraction.suggested_category, description: receiptPurposeDescription(assisted.extraction, assisted.selection) });
        } catch (e) { fail(`${errorMessage(e)} You can also choose manual entry.`, "assistant-confirm"); }
      } else go(3);
      return;
    }
    setBusy(true); setError("");
    try {
      if (step === 3) {
        const result = await persist(); if (!result) return;
        if (!result.attachments.some(a => a.kind === "receipt")) { go(2); fail("Add a receipt before submitting.", "assistant-file"); return; }
        if (!claim) router.replace(`/claims/${result.claim.id}/edit?step=review`);
        else go(4);
      } else {
        if (!savedClaim) return fail("Save your details before submitting.");
        if (!payout) return fail("Add your payout details in Profile, then return to this saved draft.");
        if (needsReply && reply.trim().length < 3) return fail("Reply to the Treasurer before resubmitting.", "claim-reply");
        await rpc(needsReply ? "ml_reply_information" : "ml_submit_claim", needsReply ? { p_claim_id: savedClaim.id, p_reply: reply.trim() } : { p_claim_id: savedClaim.id });
        notify({ title: "Claim submitted", description: "Waiting for Treasurer review. Track it in My claims." });
        router.replace(`/claims/${savedClaim.id}?submitted=1`);
      }
    } catch (e) { fail(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function saveAndExit() {
    if (busy || aiBusy) return;
    setBusy(true); setError("");
    try {
      const result = dirty || !savedClaim ? await persist() : { claim: savedClaim };
      if (!result) return;
      notify({ title: "Draft saved", description: "Continue it later from My claims." });
      router.push(`/claims/${result.claim.id}`);
    } catch (e) { fail(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function remove(attachment: Attachment) {
    setBusy(true); setError("");
    try {
      await removeAttachment(attachment.id);
      setAttachments(previous => previous.filter(a => a.id !== attachment.id));
      if (attachment.kind === "receipt") { setPlan(null); setAssisted(null); setFile(null); progress.current.uploadedFile = null; setReceiptVersion(v => v + 1); }
      notify({ title: "Receipt removed", description: "Choose a replacement before submitting." });
    } catch (e) {
      fail(errorMessage(e));
      if (progress.current.id) setAttachments(await getAttachments(progress.current.id).catch(() => attachments));
    } finally { setBusy(false); }
  }
  return <div className={styles.flow} data-keyboard={keyboardOpen} aria-busy={busy}>
    <ol className={styles.steps} aria-label="Claim steps">{steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} data-done={step > index + 1}><span>{step > index + 1 ? "✓" : index + 1}</span><b>{label}</b></li>)}</ol>
    <form onSubmit={advance} noValidate>
      <section className={`panel ${styles.card}`}>
        <div className={styles.stepTitle}><span>STEP {step} OF 4</span><span>{savedClaim ? dirty ? "Unsaved changes" : "Draft saved" : "Not submitted"}</span></div>
        <h2 ref={heading} tabIndex={-1} className={styles.heading}>{["Choose an activity", "Add your receipt", "Expense details", needsReply ? "Reply & resubmit" : "Ready to submit?"][step - 1]}</h2>
        <p className={styles.intro}>{["Which activity was this purchase for?", "Upload a receipt. AI help is optional.", "Confirm the amount, date and purpose.", "Check this summary before sending it to Treasurer."][step - 1]}</p>
        {error && <div id="claim-flow-error" tabIndex={-1}><Notice tone="error">{error}</Notice>{savedId && <Link href={`/claims/${savedId}`}>Open saved draft</Link>}</div>}
        <fieldset className={styles.fields} disabled={busy || aiBusy}>
          {step === 1 && <>
            <Field label="Activity" id="activity" hint={savedId ? "The activity is fixed once a draft is saved." : undefined}><select id="activity" value={activityId} disabled={Boolean(savedId)} onChange={e => { setActivityId(e.target.value); setAssisted(null); setFile(null); setDirty(true); }}><option value="">Choose an activity</option>{activities.filter(a => a.status === "active" || a.id === activityId).map(a => <option key={a.id} value={a.id}>{a.name}{a.status === "closed" ? " (closed)" : ""}</option>)}</select></Field>
            {selected && <div className={styles.context}><strong>{selected.name}</strong><span>Available budget {money(selected.remaining_budget)}</span></div>}
          </>}
          <div hidden={step !== 2}>
            {!!receipts.length && <div className={styles.receipts}>{receipts.map(a => <article key={a.id}><div><strong>{a.original_name}</strong><FileLink bucket="receipts" path={a.storage_path} label="View receipt" /></div><details><summary>Remove</summary><p>Remove this receipt? You will need a replacement to submit.</p><button type="button" className="button secondary" onClick={() => void remove(a)}>Remove receipt</button></details></article>)}</div>}
            {selected && <ReceiptAssistant key={selected.id + (usablePlan?.session_id ?? "manual") + receiptVersion} activityId={selected.id} availableBudget={selected.remaining_budget} initialPlan={usablePlan} onChange={value => { setAssisted(value); setDirty(true); }} onBusyChange={setAiBusy}
              onFileChange={next => { setFile(next); setDirty(true); }} existingReceiptCount={receipts.length} existingAttachmentCount={attachments.length} />}
          </div>
          {step === 3 && <>
            <div className={styles.context}><strong>{selected?.name}</strong><span>{file?.name ?? (receipts.length ? `${receipts.length} receipt${receipts.length === 1 ? "" : "s"} attached` : "No receipt yet")}</span><button type="button" className="text-button" onClick={() => go(2)}>Change receipt</button></div>
            <div className="form-grid"><Field label="Amount (RM)" id="amount"><input id="amount" readOnly={assisted?.selection.mode === "full" || assisted?.selection.mode === "auto" || assisted?.selection.mode === "simple"} inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setDirty(true); }} placeholder="0.00" maxLength={13} /></Field>
              <Field label="Purchase date" id="purchase-date"><input id="purchase-date" type="date" max={today()} value={purchaseDate} onChange={e => { setPurchaseDate(e.target.value); setDirty(true); }} /></Field></div>
            {assisted && ["full", "auto", "simple"].includes(assisted.selection.mode) && <small>Amount comes from your receipt confirmation. Choose Change receipt to revise it.</small>}
            <BudgetNotice amount={amount} available={selected?.remaining_budget} />
            <Field label="Category" id="category"><select id="category" value={category} onChange={e => { setCategory(e.target.value); setDirty(true); }}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            {purposeNeedsReview && <Notice>The receipt selection or item purposes changed. Your edited description was kept. Review it or regenerate it from your current answers.</Notice>}
            <Field label="What was this purchase for?" id="description"><textarea id="description" rows={3} maxLength={500} value={description} onChange={e => { setDescription(e.target.value); setPurposeNeedsReview(false); setDirty(true); }} placeholder="e.g. Materials for the robotics workshop" /></Field>
            {assisted && assisted.selection.items.some(i => i.included) && <>
              <small>The generated purpose uses only claimed items and your activity-purpose answers. Full item answers and exclusion reasons are saved with the receipt.</small>
              <button type="button" className="text-button" onClick={() => {
                try {
                  const next = receiptPurposeDescription(assisted.extraction, assisted.selection);
                  setDescription(next); setGeneratedPurpose(next); setPurposeNeedsReview(false); setDirty(true);
                } catch (e) { fail(`${errorMessage(e)} Choose Change receipt to complete the item answers.`, "description"); }
              }}>Regenerate purpose from item answers</button>
            </>}
          </>}
          {step === 4 && <>
            <BudgetNotice amount={amount} available={selected?.remaining_budget} />
            <div className={styles.summary}><span className={styles.total}>{money(amount)}</span><dl><div><dt>Activity</dt><dd>{selected?.name}</dd></div><div><dt>Purchase date</dt><dd>{purchaseDate}</dd></div><div><dt>Category</dt><dd>{category}</dd></div><div><dt>Purpose</dt><dd>{description}</dd></div><div><dt>Receipts</dt><dd>{receipts.length} attached</dd></div><div><dt>Payout</dt><dd>{payout ? `${payout.recipient_name} · ${payout.provider_name} · ending ${payout.account_number.slice(-4)}` : "Not added"}</dd></div></dl><button type="button" className="text-button" onClick={() => go(3)}>Edit details</button></div>
            {!payout && <Notice tone="error">Add your payout details before submitting. Your draft is saved. <Link href="/profile">Open Profile →</Link></Notice>}
            {needsReply && <div className={styles.request}><strong>Treasurer’s question</strong><p>{question}</p><Field label="What did you correct or add?" id="claim-reply"><textarea id="claim-reply" rows={3} maxLength={2000} value={reply} onChange={e => setReply(e.target.value)} /></Field></div>}
            {plan && <>
              {(!receipts.some(a => a.id === plan.attachment_id) || receipts.length !== 1 || Number(amount) !== Number(plan.calculation.expected_amount)) && <Notice tone="error">The receipt selection or claim amount has changed. Review the item calculation before submitting.</Notice>}
              <ReceiptAllocation plan={plan} claimed={amount} sourceValid={receipts.length === 1 && receipts.some(a => a.id === plan.attachment_id)} canEdit={false} />
            </>}
          </>}
        </fieldset>
        {step === 4 && savedClaim && <details className={styles.disclosure}><summary>AI pre-check <span>Optional</span></summary><AIClaimCheck compact claim={savedClaim} attachments={attachments} receiptPlan={plan} onBusyChange={setAiBusy} onEditDetails={() => go(3)} onEditReceipt={() => go(2)} onChanged={() => {}} /></details>}
      </section>
      <div className={styles.actions}>
        <div className={styles.navigation}>{step > 1 && <button type="button" className="button secondary" disabled={busy || aiBusy} onClick={() => go(step - 1)}>Back</button>}
          <button className="button primary" disabled={busy || aiBusy || (step === 4 && !payout)}>{busy ? step === 4 ? "Submitting…" : "Saving…" : ["Next: receipt →", "Next: expense details →", "Next: review →", needsReply ? "Reply & resubmit" : "Submit claim"][step - 1]}</button></div>
        <div className={styles.exit}>{step >= 3 ? <button type="button" disabled={busy || aiBusy} onClick={() => void saveAndExit()}>Save & exit</button> : <Link href={savedId ? `/claims/${savedId}` : "/claims"}>{dirty ? "Leave without saving" : "Cancel"}</Link>}<small>{step === 4 ? "After submitting: wait for Treasurer review." : "Your claim is submitted only in the final step."}</small></div>
      </div>
    </form>
  </div>;
}
