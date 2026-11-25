"use client";
import { useState } from "react";
import type { Activity, Claim, ClaimStatus } from "@/lib/types";
import { money, STATUS_LABELS, dateTime } from "@/lib/domain";
import Link from "next/link";
import { Journey } from "./Creative";
export function ClaimFeed({ claims }: { claims: Claim[] }) {
  return (
    <div className="claim-feed">
      {claims.map((c) => (
        <Link className="feed-row" href={`/claims/${c.id}`} key={c.id}>
          <span className={`feed-icon ${c.status}`}>
            {c.status === "paid" ? "✓" : "↗"}
          </span>
          <div>
            <strong>{c.activity?.name ?? "Expense claim"}</strong>
            <p>{c.description}</p>
            <small>{dateTime(c.updated_at ?? c.created_at)}</small>
          </div>
          <div>
            <strong>{money(c.amount)}</strong>
            <span className={`badge ${c.status}`}>
              {STATUS_LABELS[c.status]}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
export function ClaimOverview({ claims }: { claims: Claim[] }) {
  const [selected, setSelected] = useState<ClaimStatus>("submitted");
  const statuses: ClaimStatus[] = [
    "draft",
    "submitted",
    "approved",
    "paid",
    "rejected",
  ];
  return (
    <section className="panel status-overview">
      <span className="eyebrow">YOUR CLAIMS, AT A GLANCE</span>
      <h2>A place for every stage.</h2>
      <div
        className="status-pills"
        role="group"
        aria-label="Explore claim status"
      >
        {statuses.map((s) => (
          <button
            key={s}
            aria-pressed={selected === s}
            onClick={() => setSelected(s)}
          >
            <b>{claims.filter((c) => c.status === s).length}</b>
            <span>{STATUS_LABELS[s]}</span>
          </button>
        ))}
      </div>
      <Journey status={selected} />
      <p className="small-text">
        Based on the loaded claim history, up to 500 recent records.
      </p>
    </section>
  );
}
export function ExecutiveSummary({ activities }: { activities: Activity[] }) {
  const sum = (key: "budget" | "approved_spend" | "remaining_budget") =>
    activities.reduce((n, a) => n + Math.round(Number(a[key]) * 100), 0) / 100;
  const total = sum("budget"),
    spent = sum("approved_spend"),
    remaining = sum("remaining_budget"),
    ratio = total ? Math.round((spent / total) * 100) : 0;
  return (
    <section className="executive-hero">
      <div>
        <span className="eyebrow">CLUB FINANCIAL OVERVIEW</span>
        <h2>
          Clarity for your
          <br />
          <em>next decision.</em>
        </h2>
        <p>
          Your approved allocations, committed expenditure and room to move.
        </p>
      </div>
      <div className="executive-amount">
        <small>REMAINING ACTIVITY BUDGET</small>
        <strong>{money(remaining)}</strong>
        <progress
          value={spent}
          max={Math.max(total, 1)}
          aria-label={`${ratio}% of activity budgets committed`}
        />
        <div>
          <span>{ratio}% committed</span>
          <span>{money(total)} allocated</span>
        </div>
        <p>Allocated budgets, not your club’s bank balance.</p>
      </div>
    </section>
  );
}
export function ClaimTrend({
  claims,
}: {
  claims: { submitted_at: string | null; amount: number | string }[];
}) {
  const [selected, setSelected] = useState(5);
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 5 + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      key,
      label: d.toLocaleDateString("en-MY", { month: "short" }),
      items: claims.filter((c) => c.submitted_at?.startsWith(key)),
    };
  });
  const max = Math.max(1, ...months.map((m) => m.items.length)),
    m = months[selected];
  const amount =
    m.items.reduce((n, c) => n + Math.round(Number(c.amount) * 100), 0) / 100;
  return (
    <section className="panel trend-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SUBMISSION ACTIVITY</span>
          <h2>A six-month perspective.</h2>
        </div>
        <span className="role-pill">
          {m.label} · {m.items.length} claims
        </span>
      </div>
      <div
        className="trend-bars"
        role="group"
        aria-label="Explore monthly claim submissions"
      >
        {months.map((m, i) => (
          <button
            key={m.key}
            aria-label={`${m.label} ${m.items.length} submitted claims`}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            <span className="trend-value">{m.items.length}</span>
            <span className="trend-track">
              <i
                style={{
                  height: `${Math.max(2, (m.items.length / max) * 100)}%`,
                }}
              />
            </span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="small-text">
        {m.label}: {money(amount)} in submitted claim value. Includes later
        rejected claims; this is not cash expenditure. Based on up to 500 loaded
        records.
      </p>
    </section>
  );
}
