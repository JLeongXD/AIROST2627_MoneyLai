"use client";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useFeedback, useOperationError } from "@/components/FeedbackProvider";
import { EmptyState, Field, Loading, Notice, PageHeader, StatCard } from "@/components/UI";
import MemberActionDialog from "@/components/MemberActionDialog";
import { rpc } from "@/lib/api";
import { errorMessage } from "@/lib/domain";
import { useLoad } from "@/lib/useLoad";
import { sendInvitation, type Member, type MemberDirectory, type MembershipApplication } from "@/lib/members/types";
import styles from "./MembersPage.module.css";

type Decision = { title: string; description: string; label: string; confirm: (reason: string) => Promise<void> };
const date = (value: string) => new Date(value).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
function Badge({ value }: { value: string }) { return <span className={`${styles.badge} ${styles[value] || ""}`}>{value}</span>; }

export default function MembersPage() {
  const { user, profile } = useAuth();
  const state = useLoad(() => profile?.role === "president" ? rpc<MemberDirectory>("ml_members") : Promise.resolve(null), [profile?.role]);
  const notify = useFeedback();
  const applications = useLoad(() => profile?.role === "president" ? rpc<MembershipApplication[]>("ml_membership_applications") : Promise.resolve([]), [profile?.role]);
  const [error, setError] = useOperationError("Membership action could not be completed");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  if (profile?.role !== "president") return <Notice tone="error">Only the President can manage club members.</Notice>;
  const data = state.data;
  const query = search.toLowerCase().trim();
  const members = (data?.members ?? []).filter(m => `${m.display_name} ${m.email} ${m.role} ${m.account_status}`.toLowerCase().includes(query));
  async function invite(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy("invite"); setError("");
    notify({ title: "Sending invitation…", description: "Wait for email delivery confirmation.", tone: "progress" });
    try {
      const result = await sendInvitation({ name: name.trim(), email: email.trim() });
      setName(""); setEmail(""); notify({ title: "Invitation sent", description: result.message });
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(""); state.reload(); }
  }
  async function resend(id: string) {
    if (busy) return;
    setBusy(id); setError("");
    notify({ title: "Sending a fresh invitation…", tone: "progress" });
    try { const result = await sendInvitation({ invitationId: id }); notify({ title: "Invitation resent", description: result.message }); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(""); state.reload(); }
  }
  function change(member: Member, action: "member" | "treasurer" | "disable" | "restore") {
    const title = action === "disable" ? `Disable ${member.display_name}?` : action === "restore" ? `Restore ${member.display_name}?` : `Change ${member.display_name} to ${action}?`;
    setDecision({ title, label: "Confirm change", description: action === "disable"
      ? "Data access stops for this account, including existing sessions. Claims and financial history are retained."
      : action === "restore" ? "This account will regain access with its existing role."
      : `The account will receive ${action === "treasurer" ? "Treasurer review and reimbursement" : "Member"} permissions. Existing records are retained.`,
      confirm: async reason => {
        await rpc("ml_change_member", { p_user: member.id, p_action: action, p_reason: reason });
        notify({ title: "Membership updated", description: `${member.display_name}'s access has been updated.` }); state.reload();
      } });
  }
  function reviewApplication(application: MembershipApplication, approve: boolean) {
    setDecision({ title: `${approve ? "Approve" : "Reject"} ${application.display_name}'s application?`, label: approve ? "Approve application" : "Reject application",
      description: approve ? "They can set their MoneyLai password and activate as a Member. This does not grant Treasurer permissions." : "They will have no club access. Your reason will be visible to the applicant.",
      confirm: async reason => {
        await rpc("ml_review_membership", { p_user: application.user_id, p_approve: approve, p_reason: reason });
        notify({ title: approve ? "Application approved" : "Application rejected" }); applications.reload(); state.reload();
      } });
  }
  function handover(member: Member) {
    setDecision({ title: `Nominate ${member.display_name} as President?`, label: "Start handover",
      description: "You remain President until this member logs in and accepts. On acceptance, they become President and your role becomes Member.",
      confirm: async reason => {
        await rpc("ml_start_handover", { p_user: member.id, p_reason: reason });
        notify({ title: "Handover awaiting acceptance", description: "Ask the nominated member to sign in and review the handover banner." }); state.reload();
      } });
  }
  return <>
    <PageHeader eyebrow="PEOPLE & RESPONSIBILITIES" title="Club members"
      description="Invite people into the club, assign responsibilities and keep an accountable record of access changes." />
    {error && <Notice tone="error">{error}</Notice>}
    {state.error && <Notice tone="error">{state.error} <button className="button secondary" onClick={state.reload}>Try again</button></Notice>}
    <div className={styles.stack}>
      {data && <div className={styles.stats}>
        <StatCard label="Active members" value={String(data.members.filter(m => m.account_status === "active").length)} note="Accounts with club access" />
        <StatCard label="Awaiting acceptance" value={String(data.invitations.filter(i => i.status === "pending").length)} note="New accounts join as Members" />
        <StatCard label="Disabled accounts" value={String(data.members.filter(m => m.account_status === "disabled").length)} note="Financial history is retained" />
      </div>}
      <section className="panel" aria-labelledby="applications-heading">
        <h2 id="applications-heading">Membership applications ({applications.data?.filter(a => a.status === "pending").length ?? 0} pending)</h2>
        <p>Approve a Google application before the applicant can set a MoneyLai password and access the club.</p>
        {applications.error && <Notice tone="error">{applications.error} <button className="button secondary" onClick={applications.reload}>Retry</button></Notice>}
        {applications.loading ? <Loading /> : !applications.data?.length ? <p>No applications yet.</p> : <div className={styles.rows}>
          {applications.data.map(application => <article key={application.user_id} className={styles.row}>
            <div className={styles.rowHeader}><div className={styles.identity}><strong>{application.display_name}</strong><p>{application.email}</p></div><Badge value={application.status} /></div>
            <p className={styles.meta}>Applied {date(application.created_at)}{application.status === "approved" ? " · Waiting for password setup" : ""}</p>
            {application.reason && <p>{application.reason}</p>}
            <div className={styles.actions}>
              {application.status !== "approved" && <button className="button primary" onClick={() => reviewApplication(application, true)}>Approve</button>}
              {application.status !== "rejected" && <button className="button secondary" onClick={() => reviewApplication(application, false)}>{application.status === "approved" ? "Revoke approval" : "Reject"}</button>}
            </div>
          </article>)}
        </div>}
      </section>
      <section className="panel" aria-labelledby="invite-heading">
        <span className="eyebrow">WELCOME SOMEONE NEW</span><h2 id="invite-heading">Invite a member</h2>
        <p>The recipient receives an email link and sets their own password. Treasurer permissions can be assigned after they join.</p>
        <form className={styles.inviteForm} onSubmit={invite}>
          <Field id="invite-name" label="Member's name"><input id="invite-name" autoComplete="off" value={name} onChange={e => setName(e.target.value)} required maxLength={100} disabled={!!busy} /></Field>
          <Field id="invite-email" label="Email address"><input id="invite-email" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={!!busy} /></Field>
          <button className="button primary" disabled={!!busy || !data}>{busy === "invite" ? "Sending…" : "Send invitation"}</button>
        </form>
      </section>
      <section className="panel" aria-labelledby="directory-heading">
        <div className={styles.toolbar}><h2 id="directory-heading">Member directory</h2><input className={styles.search} type="search" aria-label="Search members" placeholder="Search name, email, role or status" value={search} onChange={e => setSearch(e.target.value)} /></div>
        {state.loading ? <Loading /> : !members.length ? <EmptyState title="No members found" description="Try another name, email or role." /> : <div className={styles.rows}>
          {members.map(member => <article key={member.id} className={styles.row}>
            <div className={styles.rowHeader}><div className={styles.identity}><strong>{member.display_name}{member.id === user?.id ? " (you)" : ""}</strong><p>{member.email}</p></div><div className={styles.badges}><Badge value={member.role} /><Badge value={member.account_status} /></div></div>
            {member.id !== user?.id && member.role !== "president" && <div className={styles.actions}>
              {member.account_status === "active" && <>
                <button className="button secondary" onClick={() => change(member, member.role === "member" ? "treasurer" : "member")}>{member.role === "member" ? "Make Treasurer" : "Make Member"}</button>
                <button className="button secondary" onClick={() => change(member, "disable")}>Disable account</button>
                <button className="button secondary" onClick={() => handover(member)}>Nominate President</button>
              </>}
              {member.account_status === "disabled" && <button className="button secondary" onClick={() => change(member, "restore")}>Restore account</button>}
            </div>}
          </article>)}
        </div>}
      </section>
      <section className="panel" aria-labelledby="invitations-heading">
        <h2 id="invitations-heading">Invitations</h2><p>Only the latest link works. Email links may expire sooner than the invitation; resend if needed.</p>
        {!data?.invitations.length ? <EmptyState title="No invitations yet" description="Use the form above to welcome your first member." /> : <div className={styles.rows}>
          {data.invitations.map(invitation => <article key={invitation.id} className={styles.row}>
            <div className={styles.rowHeader}><div className={styles.identity}><strong>{invitation.display_name}</strong><p>{invitation.email}</p></div><div className={styles.badges}><Badge value={invitation.status} />{["pending", "expired"].includes(invitation.status) && <Badge value={invitation.delivery_status} />}</div></div>
            <p className={styles.meta}>Invitation expires {date(invitation.expires_at)}{invitation.sent_at ? ` · Last email sent ${date(invitation.sent_at)}` : " · No confirmed email delivery yet"}</p>
            {["pending", "expired"].includes(invitation.status) && <div className={styles.actions}>
              <button className="button secondary" disabled={!!busy} onClick={() => void resend(invitation.id)}>{busy === invitation.id ? "Sending…" : "Resend invitation"}</button>
              <button className="button secondary" disabled={!!busy} onClick={() => setDecision({ title: "Revoke this invitation?", label: "Revoke invitation", description: `${invitation.display_name} will no longer be able to join using this invitation. You can issue a new invitation later.`, confirm: async reason => {
                await rpc("ml_revoke_invitation", { p_id: invitation.id, p_reason: reason }); notify({ title: "Invitation revoked" }); state.reload();
              } })}>Revoke</button>
            </div>}
          </article>)}
        </div>}
      </section>
      <section className="panel" aria-labelledby="history-heading"><h2 id="history-heading">Management history</h2><p>The latest 100 actions. Earlier records remain stored.</p>
        {!data?.events.length ? <p>No management actions yet.</p> : <div className={styles.rows}>{data.events.map(event => <article key={event.id} className={styles.event}>
          <strong>{event.event_type.replaceAll("_", " ")}</strong><p>{event.actor}{event.target ? ` → ${event.target}` : ""}</p>
          <p>{event.reason}</p>{event.details.email && <p>{event.details.email}</p>}
          {event.details.previous_role && <p className={styles.meta}>Role: {event.details.previous_role} → {event.details.role} · Status: {event.details.previous_status} → {event.details.status}</p>}
          <small className={styles.meta}>{date(event.created_at)}</small>
        </article>)}</div>}
      </section>
    </div>
    {decision && <MemberActionDialog {...decision} onConfirm={decision.confirm} onClose={() => setDecision(null)} />}
  </>;
}
