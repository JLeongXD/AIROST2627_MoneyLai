"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PageHeader, Notice, Loading, EmptyState } from "@/components/UI";
import { ClaimFeed } from "@/components/FinanceViews";
import ClaimsTable from "@/components/ClaimsTable";
import { listClaims, rpc } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { STATUS_LABELS, errorMessage } from "@/lib/domain";
import type { ClaimStatus } from "@/lib/types";
export default function MyClaimsPage() {
  const { user } = useAuth();
  const [view, setView] = useState("timeline");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(
    () => listClaims(user!.id),
    [user?.id],
  );
  async function remove(id: string) {
    if (
      busy ||
      !confirm("Delete this draft permanently? Remove any attachments first.")
    )
      return;
    setBusy(id);
    setMessage("");
    setDeleteError("");
    try {
      await rpc("ml_delete_claim", { p_claim_id: id });
      setMessage("Draft deleted.");
      reload();
    } catch (e) {
      setDeleteError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const filtered = (data ?? []).filter(
    (c) =>
      (!status || (status === "needs_info" ? Boolean(c.info_requested_at) : c.status === status)) &&
      `${c.description} ${c.activity?.name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="EXPENSES, ALL IN ONE PLACE"
        title="My claims"
        description="From first draft to reimbursement. Follow every step."
        action={
          <Link href="/claims/new" className="button primary">
            + New claim
          </Link>
        }
      />
      {message && <Notice tone="success">{message}</Notice>}
      {deleteError && <Notice tone="error">{deleteError}</Notice>}
      <section className="panel">
        <div
          className="view-switch"
          role="group"
          aria-label="Claim history layout"
        >
          <button
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            Timeline
          </button>
          <button
            aria-pressed={view === "cards"}
            onClick={() => setView("cards")}
          >
            Cards / Table
          </button>
        </div>
        <div className="filter-bar">
          <label className="search-field">
            <span className="sr-only">Search claims</span>
            <input
              placeholder="Search expenses or activities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            onClick={reload}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : filtered.length ? (
          view === "timeline" ? (
            <ClaimFeed claims={filtered} />
          ) : (
            <ClaimsTable claims={filtered} onDelete={remove} busyId={busy} />
          )
        ) : (
          <EmptyState
            title={
              data?.length
                ? "No matching claims"
                : "Your first claim starts here"
            }
            description={
              data?.length
                ? "Try another search or status."
                : "Save an expense draft, attach your receipt and submit it."
            }
            href={data?.length ? undefined : "/claims/new"}
            label="Create a claim"
          />
        )}
        <p className="table-note">
          Showing up to 500 recent claims. Only your own records are listed.
        </p>
      </section>
    </>
  );
}
