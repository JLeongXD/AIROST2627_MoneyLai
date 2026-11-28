"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
export type Feedback = {
  title: string;
  description?: string;
  tone?: "success" | "error" | "progress";
  href?: string;
  label?: string;
};
const FeedbackContext = createContext<(message: Feedback) => void>(() => {});
export const useFeedback = () => useContext(FeedbackContext);
export function useOperationError(title = "Action could not be completed") {
  const notify = useFeedback();
  const [error, setError] = useState("");
  const report = useCallback((description: string) => {
    setError(description);
    if (description) notify({ title, description, tone: "error" });
  }, [notify, title]);
  return [error, report] as const;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<(Feedback & { id: number }) | null>(null);
  const [paused, setPaused] = useState(false);
  const notify = useCallback((next: Feedback) => {
    setMessage({ ...next, tone: next.tone ?? "success", id: Date.now() });
  }, []);
  useEffect(() => {
    if (!message || message.tone !== "success" || paused) return;
    const timer = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [message, paused]);
  return <FeedbackContext.Provider value={notify}>
    {children}
    {message && <aside className={`feedback-toast ${message.tone}`} aria-label="Operation feedback"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}>
      <div role={message.tone === "error" ? "alert" : "status"} aria-atomic="true" key={message.id}>
        <strong className="feedback-title">
          {message.tone === "progress" ? <span className="loading-spinner" aria-hidden="true" /> : <span aria-hidden="true">{message.tone === "error" ? "!" : "✓"}</span>}
          <span>{message.title}</span>
        </strong>
        {message.description && <p>{message.description}</p>}
      </div>
      {message.href && message.label && <a href={message.href}>{message.label} →</a>}
      <button type="button" className="feedback-close" aria-label="Dismiss notification" onClick={() => { setMessage(null); setPaused(false); }}>×</button>
    </aside>}
  </FeedbackContext.Provider>;
}
