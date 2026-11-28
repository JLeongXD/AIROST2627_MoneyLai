"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader, Notice, Loading, EmptyState, StatusBadge } from "@/components/UI";
import { listClaims } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { money, dateTime } from "@/lib/domain";
import { queueClaims, queueLabels, queueKey, treasuryQuery } from "./review-queue";
import styles from "./Treasury.module.css";

export default function TreasuryPage() {
  return <Suspense fallback={<Loading />}><TreasuryList /></Suspense>;
}

function TreasuryList() {
  const params = useSearchParams();
  const { profile, user } = useAuth();
  const [tab, setTab] = useState(() => queueKey(params.get("queue")));
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [activity, setActivity] = useState(params.get("activity") ?? "");
  const query = treasuryQuery(tab, search, activity);
  useEffect(() => {
    // Preserve filters through detail navigation and the browser's Back button.
    window.history.replaceState(null, "", `/treasury${query}`);
  }, [query]);
  const state = useLoad(
    () => profile?.role === "treasurer" ? listClaims() : Promise.resolve([]),
    [profile?.role],
  );
  if (profile?.role !== "treasurer") return <Notice tone="error">Treasurer access is required. Use My claims for your personal expenses.</Notice>;
  const claims = (state.data ?? []).filter(c => c.claimant_id !== user?.id);
  const filtered = queueClaims(claims, tab, search, activity);
  const activities = Array.from(new Map(claims.map(c => [c.activity_id, c.activity?.name ?? "Activity unavailable"])).entries());
  const hasFilters = Boolean(search || activity);
  return <div className={styles.desk}>
    <PageHeader title="Review desk" description="Choose a claim to check its receipt and make a decision." />
    <section className={`panel ${styles.toolbar}`} aria-label="Find claims">
      <div className={styles.queues} role="group" aria-label="Treasury queue">
        {Object.entries(queueLabels).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key}
          onClick={() => setTab(queueKey(key))}>
          <span>{label}</span><b>{queueClaims(claims, queueKey(key)).length}</b>
        </button>)}
      </div>
      <div className={styles.filters}>
        <div><label htmlFor="treasury-search">Search claims</label><input id="treasury-search" type="search" value={search}
          onChange={e => setSearch(e.target.value)} placeholder="Member, activity or expense" /></div>
        <div><label htmlFor="treasury-activity">Activity</label><select id="treasury-activity" value={activity} onChange={e => setActivity(e.target.value)}>
          <option value="">All activities</option>{activities.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></div>
        {hasFilters && <button className="text-button" onClick={() => { setSearch(""); setActivity(""); }}>Clear filters</button>}
      </div>
    </section>
    {state.loading ? <Loading /> : state.error ? <Notice tone="error">{state.error}<button className="button secondary" onClick={state.reload}>Try again</button></Notice> : <>
      <div className={styles.listCaption}><h2>{queueLabels[tab]}</h2><span>{filtered.length} {filtered.length === 1 ? "claim" : "claims"}</span></div>
      {tab === "approved" && filtered.length > 0 && <p className={styles.help}>Transfer using your bank or e-wallet, then open the claim to record payment and proof.</p>}
      {tab === "needs_info" && <p className={styles.help}>These claims are waiting for the member to update their details and reply.</p>}
      {!filtered.length ? <EmptyState title={hasFilters ? "No matching claims" : tab === "submitted" ? "You're up to date" : "No claims here"}
        description={hasFilters ? "Try another search or clear your filters." : tab === "submitted" ? "New claims will appear here when members submit them." : "Claims will appear here when they reach this stage."} /> :
        <ul className={styles.claimList} aria-label={`${queueLabels[tab]} claims`}>
          {filtered.map(c => <li key={c.id}><Link className={styles.claimRow} href={`/treasury/${c.id}${query}`} prefetch={false}>
            <div className={styles.member}><strong>{c.claimant?.display_name ?? "Member"}</strong><span>{c.activity?.name ?? "Activity unavailable"}</span></div>
            <div className={styles.expense}><p>{c.description}</p><small>Submitted {dateTime(c.submitted_at)}</small></div>
            <div className={styles.rowAmount}><strong>{money(c.amount)}</strong>{tab === "history" && <StatusBadge status={c.status} />}</div>
            <span className={styles.rowAction}>{tab === "submitted" ? "Review claim" : tab === "approved" ? "Record payment" : "View claim"}</span>
          </Link></li>)}
        </ul>}
    </>}
    <p className={styles.help}>Your own expenses are in <Link href="/claims">My claims</Link>. Showing up to 500 recent club claims.</p>
  </div>;
}
