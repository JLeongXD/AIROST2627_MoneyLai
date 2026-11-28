"use client";
import { useEffect, useState } from "react";
import { signedFile } from "@/lib/api";
import type { Attachment } from "@/lib/types";
import { errorMessage } from "@/lib/domain";
export default function ReceiptPreview({
  attachments,
  autoOpen = false,
}: {
  attachments: Attachment[];
  autoOpen?: boolean;
}) {
  const [initial] = useState(() => attachments.find(a => a.kind === "receipt") ?? attachments[0]);
  const [selected, setSelected] = useState<Attachment | null>(autoOpen ? initial ?? null : null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(Boolean(autoOpen && initial));
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!autoOpen || !initial) return;
    let active = true;
    void signedFile("receipts", initial.storage_path).then(url => {
      if (active) { setSelected(initial); setUrl(url); }
    }).catch(e => {
      if (active) setError(errorMessage(e));
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [autoOpen, initial]);
  async function open(a: Attachment) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSelected(a);
    setUrl("");
    setZoom(false);
    try {
      setUrl(await signedFile("receipts", a.storage_path));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!attachments.length) return null;
  return (
    <section className="panel receipt-workspace">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE EVIDENCE, UP CLOSE</span>
          <h2>{autoOpen ? "Original receipt & files" : "Receipt desk"}</h2>
        </div>
        {url && (
          <button
            className="button secondary"
            onClick={() => {
              setUrl("");
              setSelected(null);
            }}
          >
            Close preview
          </button>
        )}
      </div>
      <div
        className="receipt-file-tabs"
        role="group"
        aria-label="Preview attachments"
      >
        {attachments.map((a) => (
          <button
            key={a.id}
            disabled={busy}
            className={selected?.id === a.id ? "selected" : ""}
            aria-pressed={selected?.id === a.id}
            onClick={() => open(a)}
          >
            {a.mime_type === "application/pdf" ? "PDF" : "IMG"} ·{" "}
            {a.original_name}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {busy ? (
        <div className="receipt-stage" role="status">
          Preparing your private preview…
        </div>
      ) : url && selected ? (
        <>
          <div className={`receipt-stage ${zoom ? "zoomed" : ""}`}>
            {selected.mime_type === "application/pdf" ? (
              <iframe src={url} title={`Receipt: ${selected.original_name}`} />
            ) : (
              <img
                src={url}
                alt={`Receipt: ${selected.original_name}`}
                onError={() =>
                  setError(
                    "Preview expired or unavailable. Select the file again to reload.",
                  )
                }
              />
            )}
          </div>
          <div className="form-actions">
            {selected.mime_type !== "application/pdf" && (
              <button
                className="button secondary"
                onClick={() => setZoom((v) => !v)}
              >
                {zoom ? "Fit to view" : "Zoom in"}
              </button>
            )}
            <a
              className="text-button"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original ↗
            </a>
          </div>
          <small>
            Private preview links expire. Select the file again to refresh.
          </small>
        </>
      ) : (
        <div className="receipt-stage empty-preview">
          <span>↗</span>
          <h3>A closer look, without the extra tabs.</h3>
          <p>Select a file above to inspect your receipt.</p>
        </div>
      )}
    </section>
  );
}
