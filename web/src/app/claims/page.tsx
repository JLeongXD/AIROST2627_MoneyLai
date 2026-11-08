"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ClaimStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "paid";

type Claim = {
  id: string;
  amount: number | string;
  description: string;
  status: ClaimStatus;
  created_at: string;
  activity: {
    name: string;
  } | null;
};

const statusLabels: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Pending Review",
  approved: "Approved — Awaiting Payment",
  rejected: "Rejected",
  paid: "Reimbursed",
};

const statusStyles: Record<ClaimStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  paid: "bg-green-100 text-green-800",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

export default function MyClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadClaims() {
      try {
        const supabase = createClient();

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (!isActive) return;

        if (authError || !user) {
          setError("Please sign in to view your claims.");
          return;
        }

        const { data, error: queryError } = await supabase
          .from("claims")
          .select(`
            id,
            amount,
            description,
            status,
            created_at,
            activity:activities (
              name
            )
          `)
          .eq("claimant_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100)
          .overrideTypes<Claim[], { merge: false }>();

        if (!isActive) return;

        if (queryError) {
          console.error("Failed to load claims:", queryError);

          setError(
            "Unable to load claims. Please refresh and try again."
          );
          return;
        }

        setClaims(data ?? []);
      } catch (loadError) {
        if (!isActive) return;

        console.error("Failed to connect:", loadError);

        setError(
          "Connection failed. Please check your connection and try again."
        );
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadClaims();

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">My Claims</h1>

            <p className="mt-2 text-slate-600">
              View your expense claims and reimbursement progress.
            </p>
          </div>

          <Link
            href="/claims/new"
            className="rounded-lg bg-blue-700 px-4 py-3 text-sm font-medium text-white hover:bg-blue-800"
          >
            New Claim
          </Link>
        </header>

        <nav className="mt-5 flex flex-wrap gap-4 text-sm">
          <Link
            href="/activities"
            className="text-blue-700 underline"
          >
            View Activities
          </Link>

          <Link
            href="/login"
            className="text-blue-700 underline"
          >
            Sign In
          </Link>
        </nav>

        {isLoading ? (
          <p role="status" className="mt-8 text-slate-600">
            Loading your claims...
          </p>
        ) : error ? (
          <div role="alert" className="mt-8">
            <p className="text-red-600">{error}</p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"
            >
              Try Again
            </button>
          </div>
        ) : claims.length === 0 ? (
          <section className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <h2 className="text-lg font-semibold">No claims yet</h2>

            <p className="mt-2 text-sm text-slate-500">
              Create your first expense claim to get started.
            </p>

            <Link
              href="/claims/new"
              className="mt-4 inline-block text-sm font-medium text-blue-700 underline"
            >
              Create a Claim
            </Link>
          </section>
        ) : (
          <section className="mt-8" aria-label="Your expense claims">
            <p className="mb-4 text-sm text-slate-500">
              Showing up to 100 of your most recent claims.
            </p>

            <ul className="space-y-4">
              {claims.map((claim) => (
                <li
                  key={claim.id}
                  className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      {claim.activity?.name ?? "Activity unavailable"}
                    </h2>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        statusStyles[claim.status] ??
                        "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {statusLabels[claim.status] ?? "Unknown Status"}
                    </span>
                  </div>

                  <p className="mt-4 text-2xl font-bold">
                    RM {Number(claim.amount).toFixed(2)}
                  </p>

                  <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">
                    {claim.description}
                  </p>

                  <p className="mt-4 text-xs text-slate-500">
                    Created: {formatDate(claim.created_at)}
                  </p>

                  {claim.status === "draft" && (
                    <Link
                        href={`/claims/${claim.id}/edit`}
                        className="mt-4 inline-block text-blue-700 underline"
                    >
                        Edit
                    </Link>
                    )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}