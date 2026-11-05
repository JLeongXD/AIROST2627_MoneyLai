"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Activity = {
  id: string;
  name: string;
  description: string | null;
  budget: number;
  status: "active" | "closed";
};

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");

  async function handleLoadActivities() {
    if (isLoading) return;

    setIsLoading(true);
    setError("");
    setHasLoaded(false);
    setActivities([]);

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setError("Please sign in before viewing activities.");
        return;
      }

      const { data, error: queryError } = await supabase
        .from("activities")
        .select("id, name, description, budget, status")
        .order("created_at", { ascending: false });

      if (queryError) {
        setError("Unable to load activities. Please try again.");
        return;
      }

      setActivities(data ?? []);
      setHasLoaded(true);
    } catch {
      setError("Connection failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Activities</h1>

          <Link
            href="/login"
            className="text-sm font-medium text-blue-700 underline"
          >
            Sign In
          </Link>
        </header>

        <p className="mt-2 text-slate-600">
          View club activities and their allocated budgets.
        </p>

        <button
          type="button"
          onClick={handleLoadActivities}
          disabled={isLoading}
          className="mt-6 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Loading..." : "Load Activities"}
        </button>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <div aria-live="polite">
          {hasLoaded && activities.length === 0 && (
            <p className="mt-6 text-slate-500">
              No activities found.
            </p>
          )}

          <ul className="mt-6 space-y-4">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-semibold">
                    {activity.name}
                  </h2>

                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                    {activity.status === "active" ? "Active" : "Closed"}
                  </span>
                </div>

                {activity.description && (
                  <p className="mt-3 text-sm text-slate-600">
                    {activity.description}
                  </p>
                )}

                <p className="mt-4 text-sm text-slate-500">
                  Allocated Budget
                </p>

                <p className="mt-1 text-2xl font-bold">
                  RM {Number(activity.budget).toFixed(2)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}