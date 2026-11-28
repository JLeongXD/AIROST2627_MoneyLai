import Link from "next/link";
import { Icon } from "@/components/Creative";
import { money, dateTime, STATUS_LABELS } from "@/lib/domain";
import type { Activity, Claim } from "@/lib/types";
import styles from "./DashboardOverview.module.css";

type Props = {
  name: string;
  userId: string;
  treasurer: boolean;
  activities: Activity[];
  claims: Claim[];
};

const sum = (claims: Claim[]) =>
  claims.reduce((total, claim) => total + Math.round(Number(claim.amount) * 100), 0) / 100;
const needsInformation = (claim: Claim) =>
  claim.status === "needs_info" || Boolean(claim.info_requested_at);
const latestFirst = (a: Claim, b: Claim) =>
  Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at);
const claimCount = (count: number) => `${count} ${count === 1 ? "claim" : "claims"}`;

export default function DashboardOverview({ name, userId, treasurer, activities, claims }: Props) {
  const ownClaims = claims.filter((claim) => claim.claimant_id === userId);
  const visibleClaims = treasurer ? claims : ownClaims;
  const pending = visibleClaims.filter((claim) => claim.status === "submitted" && !needsInformation(claim));
  const approved = visibleClaims.filter((claim) => claim.status === "approved");
  const paid = visibleClaims.filter((claim) => claim.status === "paid");
  const reviewQueue = pending.filter((claim) => claim.claimant_id !== userId);
  const paymentQueue = approved.filter((claim) => claim.claimant_id !== userId);
  const recent = [...visibleClaims].sort(latestFirst).slice(0, 5);
  const activeActivities = activities.filter((activity) => activity.status === "active").slice(0, 3);

  const actions = visibleClaims.flatMap((claim) => {
    if (claim.claimant_id === userId) {
      if (needsInformation(claim)) return [{ claim, priority: 0, label: "Add details and reply", href: `/claims/${claim.id}` }];
      if (claim.status === "rejected") return [{ claim, priority: 1, label: "Review feedback and revise", href: `/claims/${claim.id}` }];
      if (claim.status === "draft") return [{ claim, priority: 4, label: "Continue your draft", href: `/claims/${claim.id}/edit` }];
    } else if (treasurer) {
      if (claim.status === "submitted" && !needsInformation(claim)) return [{ claim, priority: 2, label: "Review this claim", href: `/treasury/${claim.id}` }];
      if (claim.status === "approved") return [{ claim, priority: 3, label: "Record external payment", href: `/treasury/${claim.id}` }];
    }
    return [];
  }).sort((a, b) => a.priority - b.priority || latestFirst(a.claim, b.claim));

  return (
    <div className={styles.overview} data-has-attention={actions.length > 0}>
      <section className={styles.hero} aria-labelledby="overview-title">
        <div className={styles.heroIntro}>
          <span className={styles.kicker}><span /> YOUR MONEY, IN MOTION</span>
          <h1 id="overview-title">
            {treasurer ? "Make room for" : "Good things ahead,"}
            <em>{treasurer ? "what’s next." : `${name}.`}</em>
          </h1>
          <p>{treasurer ? "Keep reimbursements moving." : "Your expenses, moving forward."}</p>
        </div>
        <div className={styles.heroArt}>
          <span className={styles.orbit} aria-hidden="true" />
          <span className={`${styles.orbit} ${styles.outerOrbit}`} aria-hidden="true" />
          <div className={styles.receipt}>
            <span className={styles.receiptLabel}>{treasurer ? "YOUR REVIEW QUEUE" : "AWAITING REIMBURSEMENT"}</span>
            <strong>{treasurer ? String(reviewQueue.length).padStart(2, "0") : money(sum(approved))}</strong>
            <span className={styles.receiptNote}>
              {treasurer
                ? `${claimCount(reviewQueue.length)} ready for review`
                : approved.length ? `${claimCount(approved.length)} approved, awaiting payment` : "No approved claims awaiting payment"}
            </span>
            <span className={styles.receiptCheck}><span aria-hidden="true">✓</span> Every step accounted for</span>
          </div>
          <span className={styles.spark} aria-hidden="true"><Icon name="spark" size={28} /></span>
        </div>
        <Link className={`button lime ${styles.heroAction}`} href={treasurer ? "/treasury" : "/claims/new"}>
          {treasurer ? "Open review desk" : "Create a claim"}<Icon name="arrow" size={18} />
        </Link>
      </section>

      {actions.length > 0 && <section className={styles.attention} aria-labelledby="attention-title">
        <div className={styles.sectionHeading}>
          <h2 id="attention-title">Needs your attention</h2>
          <span className={styles.actionCount}>{actions.length}</span>
        </div>
        <ul className={styles.actionList}>
          {actions.slice(0, 3).map(({ claim, label, href }) => <li key={claim.id}>
            <Link href={href}>
              <div><strong>{claim.activity?.name ?? "Expense claim"} · {money(claim.amount)}</strong><span>{label}</span></div>
              <Icon name="arrow" size={18} />
            </Link>
          </li>)}
        </ul>
        {actions.length > 3 && <p className={styles.actionNote}>Showing 3 of {actions.length} claims needing attention.</p>}
        <div className={styles.attentionLinks}>
          {treasurer && <Link href="/treasury">Review desk ↗</Link>}
          {actions.some(({ claim }) => claim.claimant_id === userId) && <Link href="/claims">My claims ↗</Link>}
        </div>
      </section>}

      <section className={styles.summary} aria-label={treasurer ? "Club claim summary" : "My claim summary"}>
        <div className={styles.metric}>
          <span className={styles.metricIcon} aria-hidden="true"><Icon name={treasurer ? "wallet" : "receipt"} size={23} /></span>
          <dl>
            <dt>{treasurer ? "Awaiting payment" : "Pending review"}</dt>
            <dd className={styles.metricValue}>{treasurer ? money(sum(paymentQueue)) : pending.length}</dd>
            <dd className={styles.metricNote}>{treasurer ? `${claimCount(paymentQueue.length)} approved` : `${money(sum(pending))} awaiting review`}</dd>
          </dl>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricIcon} aria-hidden="true"><Icon name="wallet" size={23} /></span>
          <dl>
            <dt>{treasurer ? "Club reimbursements" : "Reimbursed"}</dt>
            <dd className={styles.metricValue}>{money(sum(paid))}</dd>
            <dd className={styles.metricNote}>{claimCount(paid.length)} completed</dd>
          </dl>
        </div>
      </section>

      <section className={styles.recent} aria-labelledby="recent-claims-title">
        <div className={styles.sectionHeading}>
          <h2 id="recent-claims-title">{treasurer ? "Recent club claims" : "Your recent claims"}</h2>
          <Link href={treasurer ? "/treasury" : "/claims"}>{treasurer ? "Review desk" : "View all"} <span aria-hidden="true">↗</span></Link>
        </div>
        {recent.length ? (
          <ul className={styles.claimList}>
            {recent.map((claim) => {
              const status = needsInformation(claim) ? "needs_info" : claim.status;
              return <li key={claim.id}>
                <Link className={styles.claimRow} href={treasurer && claim.claimant_id !== userId ? `/treasury/${claim.id}` : `/claims/${claim.id}`}>
                  <span className={styles.claimIcon} data-status={status} aria-hidden="true">{status === "paid" ? "✓" : <Icon name="receipt" size={19} />}</span>
                  <div className={styles.claimCopy}>
                    <div className={styles.claimTop}>
                      <strong>{claim.activity?.name ?? "Expense claim"}</strong>
                      <strong className={styles.claimAmount}>{money(claim.amount)}</strong>
                    </div>
                    <p>{treasurer && claim.claimant?.display_name ? `${claim.claimant.display_name} · ` : ""}{claim.description}</p>
                    <div className={styles.claimMeta}>
                      <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>
                      <time dateTime={claim.updated_at || claim.created_at}>{dateTime(claim.updated_at || claim.created_at)}</time>
                    </div>
                  </div>
                </Link>
              </li>;
            })}
          </ul>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Icon name="receipt" size={30} /></span>
            <h3>{treasurer ? "No club claims yet" : "Your first claim starts here"}</h3>
            <p>{treasurer ? "Submitted claims will appear here for review." : "Create a claim above, add your receipt, and track it here."}</p>
          </div>
        )}
      </section>

      <section className={styles.activities} aria-labelledby="activities-title">
        <div className={styles.sectionHeading}>
          <h2 id="activities-title">Activity budgets</h2>
          <Icon name="activity" size={22} />
        </div>
        {activeActivities.length ? <ul className={styles.budgetList}>
          {activeActivities.map((activity) => {
            const budget = Number(activity.budget);
            const ratio = budget > 0 ? Math.round(Number(activity.approved_spend) / budget * 100) : 0;
            return <li key={activity.id}>
              <div className={styles.budgetTitle}><span className={styles.activityInitial} aria-hidden="true">{activity.name.slice(0, 1)}</span><strong>{activity.name}</strong></div>
              <progress value={Math.max(0, Math.min(100, ratio))} max={100} aria-label={`${activity.name}: ${ratio}% of budget committed`} />
              <div className={styles.budgetMeta}><span>{money(activity.remaining_budget)} available</span><span>{ratio}% committed</span></div>
            </li>;
          })}
        </ul> : <p className={styles.budgetEmpty}>Approved activity budgets will appear here.</p>}
        <Link className={styles.activitiesLink} href="/activities">Explore activities <span aria-hidden="true">↗</span></Link>
        <p className={styles.budgetNote}>Allocated budgets, not a bank balance.</p>
      </section>

      <p className={styles.historyNote}>
        {treasurer ? "Club totals and history" : "Your totals and history"} reflect up to 500 recent claims.
        {treasurer && " Review and payment queues exclude your own claims."}
      </p>
    </div>
  );
}
