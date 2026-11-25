"use client";
import { useState } from "react";
import { useFeedback } from "./FeedbackProvider";
import { Notice } from "./UI";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/domain";
import styles from "./ActivityExport.module.css";

export default function ActivityExport({ activityId, summary = false }: { activityId: string; summary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notify = useFeedback();
  async function exportPack() {
    if (busy) return;
    setBusy(true); setError("");
    notify({ title: "Preparing activity pack…", description: "Keep this page open while the report is generated.", tone: "progress" });
    let storagePath: string | undefined;
    try {
      const response = await fetch(`/api/activities/${activityId}/export`, { method: "POST", signal: AbortSignal.timeout(180000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not export this activity.");
      storagePath = result.path;
      const file = await fetch(result.url, { cache: "no-store", signal: AbortSignal.timeout(120000) });
      if (!file.ok) throw new Error("Download failed or expired. Click export to generate a new link.");
      const url = URL.createObjectURL(await file.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify({ title: "Activity pack download started", description: result.issues > 0
        ? `${result.issues} evidence issue(s) need attention. Open the evidence-completeness sheet before handing in the pack.`
        : "Open the ZIP, then review activity-ledger.xlsx and activity-report.pdf before handing it in." });
    } catch (e) {
      const message = e instanceof Error && e.name === "TimeoutError" ? "Export timed out. Please try again with fewer attachments." : errorMessage(e);
      setError(message); notify({ title: "Activity export failed", description: message, tone: "error" });
    } finally {
      if (storagePath) {
        // Private temporary files are no longer needed once copied into the browser.
        try { await createClient().storage.from("activity-exports").remove([storagePath]); } catch { /* Next export retries stale-file cleanup. */ }
      }
      setBusy(false);
    }
  }
  return <div className={styles.export}>
    <button className="button secondary" disabled={busy} onClick={exportPack} aria-busy={busy}>
      {busy ? "Preparing pack…" : summary ? "Export summary pack ↓" : "Export activity pack ↓"}
    </button>
    <small>{summary ? "Excel + PDF summary. Receipts and private audit records are excluded." : "Excel + linked PDF + original receipts and payment proof."}</small>
    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}
