"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field, Notice } from "./UI";
import { errorMessage } from "@/lib/domain";
import styles from "@/features/members/MembersPage.module.css";

export default function MemberActionDialog({ title, description, label, onConfirm, onClose }: {
  title: string; description: string; label: string;
  onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (reason.trim().length < 3) { setError("Enter a reason of 3 to 500 characters."); return; }
    setBusy(true); setError("");
    try { await onConfirm(reason.trim()); onClose(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="member-dialog-title"
    aria-describedby="member-dialog-description" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <span className="eyebrow">MEMBERSHIP DECISION</span>
      <h2 id="member-dialog-title">{title}</h2>
      <p id="member-dialog-description">{description}</p>
      <Field id="management-reason" label="Reason for the management record">
        <textarea id="management-reason" value={reason} maxLength={500} minLength={3} required rows={3}
          disabled={busy} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.actions}>
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? "Saving…" : label}</button>
      </div>
    </form>
  </dialog>;
}
