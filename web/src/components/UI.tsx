"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { STATUS_LABELS, errorMessage } from "@/lib/domain";
import { signedFile } from "@/lib/api";
import type { ClaimStatus } from "@/lib/types";
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="header-action">{action}</div>}
    </header>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "error" | "success" | "info";
}) {
  return (
    <div
      className={`notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-panel" role="status">
      <span className="spinner" />
      Loading your workspace…
    </div>
  );
}
export function NextStep({ title, description, href, label, onAction }: {
  title: string; description: string; href: string; label: string; onAction?: () => void;
}) {
  return <section className="next-step" aria-label="Your next step">
    <div><strong>{title}</strong><p>{description}</p></div>
    {onAction ? <button type="button" className="button secondary" onClick={onAction}>{label} →</button> : <Link className="button secondary" href={href}>{label} →</Link>}
  </section>;
}
export function EmptyState({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">▤</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <Link className="button primary" href={href}>
          {label}
        </Link>
      )}
    </div>
  );
}
export function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span className={`badge ${status}`}>{STATUS_LABELS[status] ?? status}</span>
  );
}
export function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function Field({
  label,
  id,
  children,
  hint,
}: {
  label: string;
  id: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function FileLink({
  bucket,
  path,
  label,
}: {
  bucket: string;
  path: string;
  label: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      setUrl(await signedFile(bucket, path));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="file-link">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            setTimeout(() => setUrl(""), 0);
          }}
        >
          {label} ↗
        </a>
      ) : (
        <button
          type="button"
          className="text-button"
          onClick={prepare}
          disabled={busy}
        >
          {busy ? "Preparing…" : label}
        </button>
      )}
      {error && <small className="error-text">{error}</small>}
    </span>
  );
}
