"use client";
import Link from "next/link";
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
  return (
    <div className="table-scroll">
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
              {showClaimant && <td>{c.claimant?.display_name ?? "Member"}</td>}
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
  );
}
