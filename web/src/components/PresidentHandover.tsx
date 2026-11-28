"use client";
import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useFeedback } from "./FeedbackProvider";
import MemberActionDialog from "./MemberActionDialog";
import { rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import type { Handover } from "@/lib/members/types";
import styles from "@/features/members/MembersPage.module.css";

export default function PresidentHandover() {
  const { user, refreshProfile } = useAuth();
  const notify = useFeedback();
  const state = useLoad(() => rpc<Handover | null>("ml_handover_status"), [user?.id]);
  const [action, setAction] = useState<"accept" | "decline" | "cancel" | null>(null);
  const h = state.data;
  if (!h) return null;
  const incoming = h.to_id === user?.id;
  return <section className={styles.handover} aria-labelledby="handover-heading">
    <span className="eyebrow">PRESIDENT HANDOVER</span>
    <h2 id="handover-heading">{incoming ? `${h.from_name} nominated you as President` : `Awaiting ${h.to_name}'s acceptance`}</h2>
    <p>{h.reason}</p>
    <p>On acceptance, {h.to_name} becomes President and {h.from_name} becomes a Member. Current permissions remain until then.</p>
    <small>Respond before {new Date(h.expires_at).toLocaleString("en-MY")}. No email is sent for this in-app handover.</small>
    <div className={styles.actions}>
      {incoming ? <><button className="button primary" onClick={() => setAction("accept")}>Review & accept handover</button><button className="button secondary" onClick={() => setAction("decline")}>Decline</button></>
        : <button className="button secondary" onClick={() => setAction("cancel")}>Cancel handover</button>}
    </div>
    {action && <MemberActionDialog title={action === "accept" ? "Accept President responsibilities?" : `${action === "cancel" ? "Cancel" : "Decline"} this handover?`}
      description={action === "accept" ? "You will receive President permissions. The outgoing President becomes a Member. President permissions do not include Treasurer access to other members' receipts or payouts." : "The current President keeps their role. This decision is recorded in management history."}
      label={action === "accept" ? "Accept & become President" : "Confirm decision"} onClose={() => setAction(null)}
      onConfirm={async reason => {
        await rpc("ml_resolve_handover", { p_id: h.id, p_action: action, p_reason: reason });
        notify({ title: action === "accept" ? "President handover completed" : "Handover updated", description: action === "accept" ? "Your permissions have been updated. Open Overview to continue." : "The current President keeps their role." });
        state.reload(); refreshProfile();
      }} />}
  </section>;
}
