"use client";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import type { Activity, ClaimStatus } from "@/lib/types";
import { money } from "@/lib/domain";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3z M9 8h6 M9 12h6",
    activity: "M3 7h18v14H3z M7 3v8 M17 3v8 M3 11h18",
    wallet: "M3 5h17v15H3z M16 10h6v6h-6z",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
    chart: "M4 3v18h17 M8 16v-4 M13 16V7 M18 16v-7",
    menu: "M3 6h18 M3 12h18 M3 18h18",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}
export function Journey({
  status,
  compact = false,
}: {
  status: ClaimStatus;
  compact?: boolean;
}) {
  const steps = ["Draft", "Submitted", "Approved", "Reimbursed"];
  const index = { draft: 0, submitted: 1, needs_info: 1, approved: 2, paid: 3, rejected: 1 }[
    status
  ];
  return (
    <div className={`journey ${compact ? "compact" : ""}`}>
      <ol aria-label="Claim progress">
        {steps.map((s, i) => (
          <li
            key={s}
            className={i < index ? "done" : i === index ? "current" : ""}
            aria-current={i === index ? "step" : undefined}
          >
            <span>{i < index ? "✓" : String(i + 1).padStart(2, "0")}</span>
            <small>
              {i === 1 && status === "needs_info" ? "Information needed" : i === 1 && status === "rejected" ? "Revision needed" : s}
            </small>
          </li>
        ))}
      </ol>
      {!compact && (
        <p>
          {
            {
              draft:
                "Your next step: add your receipt, then submit for review.",
              submitted: "Your claim is with Treasurer for review.",
              needs_info: "Your next step: answer the Treasurer’s questions, update your draft and resubmit.",
              approved:
                "Approved. Treasurer will record payment after transferring the funds.",
              paid: "Reimbursement recorded. Your payment details are below.",
              rejected:
                "Review the feedback, revise your claim and submit again.",
            }[status]
          }
        </p>
      )}
    </div>
  );
}
export function WorkspaceHero({
  name,
  treasurer = false,
  count = 0,
  amount = 0,
}: {
  name: string;
  treasurer?: boolean;
  count?: number;
  amount?: number;
}) {
  return (
    <section className="workspace-hero">
      <div>
        <span className="hero-kicker">
          <span className="live-dot" /> YOUR MONEY, IN MOTION
        </span>
        <h2>
          {treasurer ? "Make room for" : "Good things ahead,"}
          <br />
          {treasurer ? <em>what’s next.</em> : <em>{name}.</em>}
        </h2>
        <p>
          {treasurer
            ? "A little less admin. A lot more clarity. Keep your club’s claims moving forward."
            : "Big ideas deserve less paperwork. Let’s get your expenses moving."}
        </p>
        <Link
          className="button lime"
          href={treasurer ? "/treasury" : "/claims/new"}
        >
          {treasurer ? "Open review queue" : "Create a claim"}
          <Icon name="arrow" size={18} />
        </Link>
      </div>
      <div className="hero-art">
        <span className="orbit one" />
        <span className="orbit two" />
        <div className="mini-receipt">
          <span className="mini-label">
            {treasurer ? "YOUR REVIEW QUEUE" : "AWAITING REIMBURSEMENT"}
          </span>
          <strong>
            {treasurer ? String(count).padStart(2, "0") : money(amount)}
          </strong>
          <div className="mini-rule" />
          <span>
            {treasurer
              ? "Claims ready for attention"
              : "Approved, waiting for payment"}
          </span>
          <div className="mini-check">
            ✓{" "}
            <span>
              {treasurer ? "You’re in control" : "Every step accounted for"}
            </span>
          </div>
        </div>
        <span className="floating-spark">
          <Icon name="spark" size={32} />
        </span>
      </div>
    </section>
  );
}
export function BudgetExplorer({ activities }: { activities: Activity[] }) {
  const [id, setId] = useState("");
  const selected = activities.find((a) => a.id === id) ?? activities[0];
  if (!selected)
    return (
      <section className="panel">
        <h2>Room for your next big idea.</h2>
        <p>Approved activity budgets will appear here.</p>
      </section>
    );
  const ratio =
    Number(selected.budget) > 0
      ? Math.round(
          (Number(selected.approved_spend) / Number(selected.budget)) * 100,
        )
      : 0;
  return (
    <section className="panel budget-explorer">
      <div className="section-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h2>Every activity. In perspective.</h2>
        </div>
        <Link href="/activities">Explore all ↗</Link>
      </div>
      <div className="explorer-body">
        <div
          className="activity-selector"
          role="group"
          aria-label="Explore activity budgets"
        >
          {activities.slice(0, 8).map((a, i) => (
            <button
              key={a.id}
              aria-pressed={selected.id === a.id}
              onClick={() => setId(a.id)}
              className={selected.id === a.id ? "chosen" : ""}
            >
              <span
                className="activity-initial"
                style={
                  {
                    "--tile": ["#e7edc9", "#e6def3", "#d4e9e6", "#f6e2d2"][
                      i % 4
                    ],
                  } as CSSProperties
                }
              >
                {a.name.slice(0, 1)}
              </span>
              <span>
                <strong>{a.name}</strong>
                <small>{money(a.budget)} allocated</small>
              </span>
              <span>↗</span>
            </button>
          ))}
        </div>
        <div className="budget-visual">
          <div
            className="budget-ring"
            role="img"
            aria-label={`${ratio}% of ${selected.name} budget committed`}
            style={
              {
                "--used": `${Math.min(100, Math.max(0, ratio))}%`,
              } as CSSProperties
            }
          >
            <div>
              <strong>
                {ratio}
                <small>%</small>
              </strong>
              <span>committed</span>
            </div>
          </div>
          <h3>{selected.name}</h3>
          <div className="budget-legend">
            <span>
              <i />
              {money(selected.approved_spend)} committed
            </span>
            <span>
              <i />
              {money(selected.remaining_budget)} available
            </span>
          </div>
          <p className="muted">Allocated budget, not a bank balance.</p>
        </div>
      </div>
    </section>
  );
}
