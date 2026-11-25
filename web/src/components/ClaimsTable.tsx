"use client";
import Link from "next/link";
import { useState } from "react";
import { Journey } from "./Creative";
import { dateTime, money } from "@/lib/domain";
import { StatusBadge } from "./UI";
import type { Claim } from "@/lib/types";
export default function ClaimsTable({
  claims,
  showClaimant = false,
  onDelete,
  busyId,
}: {
  claims: Claim[];
  showClaimant?: boolean;
  onDelete?: (id: string) => void;
  busyId?: string | null;
}) {
  const [view, setView] = useState<"cards" | "table">("cards");
  return (
    <>
      <div className="view-switch" role="group" aria-label="Claims display">
        <button
          aria-pressed={view === "cards"}
          onClick={() => setView("cards")}
        >
          Cards
        </button>
        <button
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
        >
          Table
        </button>
      </div>
      {view === "cards" ? (
        <div className="claims-cards">
          {claims.map((c) => (
            <article key={c.id} className="claim-ticket">
              <div className="ticket-top">
                <div className="ticket-meta">
                  <small>ML / {c.id.slice(0, 6).toUpperCase()}</small>
                  <StatusBadge status={c.status} />
                </div>
                <h3>
                  <Link href={`/claims/${c.id}`}>
                    {c.activity?.name ?? "Expense claim"}
                  </Link>
                </h3>
                <p>{c.description}</p>
                <strong className="ticket-amount">{money(c.amount)}</strong>
              </div>
              <Journey status={c.status} compact />
              <div className="ticket-footer">
                <span>
                  {showClaimant
                    ? (c.claimant?.display_name ?? "Member")
                    : c.category}
                </span>
                <div className="row-actions">
                  <Link href={`/claims/${c.id}`}>Open ↗</Link>
                  {c.status === "draft" && onDelete && (
                    <>
                      <Link href={`/claims/${c.id}/edit`}>Edit</Link>
                      <button
                        className="text-button danger-text"
                        disabled={Boolean(busyId)}
                        onClick={() => onDelete(c.id)}
                      >
                        {busyId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label="Claims table, scroll horizontally for more columns"
          tabIndex={0}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Expense</th>
                {showClaimant && <th>Member</th>}
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="claim-title" href={`/claims/${c.id}`}>
                      {c.description}
                    </Link>
                    <small>{c.activity?.name ?? "Activity unavailable"}</small>
                  </td>
                  {showClaimant && (
                    <td>{c.claimant?.display_name ?? "Member"}</td>
                  )}
                  <td className="amount-cell">{money(c.amount)}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="date-cell">{dateTime(c.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <Link href={`/claims/${c.id}`}>Open</Link>
                      {c.status === "draft" && onDelete && (
                        <>
                          <Link href={`/claims/${c.id}/edit`}>Edit</Link>
                          <button
                            className="text-button danger-text"
                            disabled={Boolean(busyId)}
                            onClick={() => onDelete(c.id)}
                          >
                            {busyId === c.id ? "Deleting…" : "Delete"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
