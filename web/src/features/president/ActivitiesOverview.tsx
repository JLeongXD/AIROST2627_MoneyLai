"use client";
import { useState } from "react";
import Link from "next/link";
import type { Activity } from "@/lib/types";
import { money } from "@/lib/domain";
import styles from "./PresidentPage.module.css";

function usage(activity: Activity) {
  return Number(activity.budget) > 0 ? Math.round(Number(activity.approved_spend) / Number(activity.budget) * 100) : 0;
}

export default function ActivitiesOverview({ activities }: { activities: Activity[] }) {
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const visible = activities.filter(a => filter === "all" || a.status === filter);
  const selected = visible.find(a => a.id === selectedId);
  return <section className={styles.activities} id="activity-overview" aria-labelledby="activities-title">
    <div className={styles.sectionHeading}>
      <h2 id="activities-title">Activities <span>{activities.length}</span></h2>
      <div className={styles.activityTools}>
        <select aria-label="Filter activities" value={filter} onChange={e => { setFilter(e.target.value); setSelectedId(""); }}>
          <option value="all">All activities</option><option value="active">Active</option><option value="closed">Closed</option>
        </select>
        <Link href="/activities">Manage activities ↗</Link>
      </div>
    </div>
    {!visible.length ? <div className={`panel ${styles.section}`}><p>No {filter === "all" ? "" : `${filter} `}activities yet.</p></div> : <div className={styles.budgets}>
      {visible.map(a => {
        const ratio = usage(a);
        const hasBudget = Number(a.budget) > 0;
        return <button key={a.id} className={`${styles.budgetCard} ${ratio >= 80 || Number(a.remaining_budget) < 0 ? styles.watch : ""}`}
          aria-expanded={selected?.id === a.id} aria-controls={selected?.id === a.id ? "activity-budget-detail" : undefined}
          onClick={() => setSelectedId(selected?.id === a.id ? "" : a.id)}>
          <div className={styles.cardHeading}><h3>{a.name}</h3><span className={styles.status}>{a.status === "active" ? "Active" : "Closed"}</span></div>
          <div className={styles.usage}><strong>{hasBudget ? `${ratio}%` : "—"}</strong><span>{hasBudget ? "budget used" : "No budget allocated"}</span></div>
          <div className={styles.track} role="meter" aria-label={`${a.name} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, ratio))} aria-valuetext={hasBudget ? `${ratio}% committed` : "No budget allocated"}>
            <span style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }} />
          </div>
          <div className={styles.allocation}><span>{money(a.approved_spend)} / {money(a.budget)}</span><span>used / allocated</span></div>
          <div className={styles.remaining}><strong>{money(a.remaining_budget)}</strong><span>{Number(a.remaining_budget) < 0 ? "over budget" : "remaining"}</span></div>
          <div className={styles.cardFooter}><span>Pending review <b>{money(a.pending_amount)}</b></span><span>Unpaid <b>{money(a.unpaid_amount)}</b></span></div>
          <span className={styles.cardHint}>{selected?.id === a.id ? "Close details −" : "View details +"}</span>
        </button>;
      })}
    </div>}
    {selected && <div id="activity-budget-detail" className={styles.activityDetail}>
      <div className={styles.ring}>
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle className={styles.ringTrack} cx="60" cy="60" r="52" /><circle className={styles.ringFill} cx="60" cy="60" r="52" pathLength="100" strokeDasharray={`${Math.min(100, Math.max(0, usage(selected)))} 100`} /></svg>
        <div><strong>{Number(selected.budget) > 0 ? `${usage(selected)}%` : "—"}</strong><span>Budget used</span></div>
      </div>
      <div className={styles.detailText}><h3>{selected.name}</h3>
        {selected.description && <p>{selected.description}</p>}
        <dl><div><dt>Allocated</dt><dd>{money(selected.budget)}</dd></div><div><dt>Committed</dt><dd>{money(selected.approved_spend)}</dd></div><div><dt>Reimbursed</dt><dd>{money(selected.paid_amount)}</dd></div><div><dt>Remaining</dt><dd>{money(selected.remaining_budget)}</dd></div></dl>
        <small>Used budget includes approved and reimbursed claims. Pending claims do not reserve budget.</small>
      </div>
    </div>}
  </section>;
}
