"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Activity = {
  id: string;
  name: string;
};

export default function NewClaimPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityId, setActivityId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const fieldClass =
    "mt-2 w-full rounded-lg border border-slate-300 bg-white p-3";

  async function handleLoadActivities() {
    if (isLoading || isSaving) return;

    setIsLoading(true);
    setMessage("");
    setActivities([]);
    setActivityId("");

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setMessage("Please sign in first.");
        return;
      }

      const { data, error } = await supabase
        .from("activities")
        .select("id, name")
        .eq("status", "active")
        .order("name");

      if (error) {
        console.error("Failed to load activities:", error);

        setMessage(
          `Unable to load activities: ${error.message} (Code: ${error.code})`
        );

        return;
      }

      setActivities(data ?? []);

      if (!data || data.length === 0) {
        setMessage("No active activities are available.");
      }
    } catch {
      setMessage("Connection failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving || isLoading) return;

    setMessage("");

    if (!activityId) {
      setMessage("Please select an activity.");
      return;
    }

    const numericAmount = Number(amount);

    if (
      !/^\d+(\.\d{1,2})?$/.test(amount.trim()) ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      setMessage(
        "Please enter a positive amount with up to two decimal places."
      );
      return;
    }

    if (
      description.trim().length === 0 ||
      description.trim().length > 500
    ) {
      setMessage("Please enter a description of 1 to 500 characters.");
      return;
    }

    setIsSaving(true);

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        setMessage("Please sign in before saving a claim.");
        return;
      }

      const { error } = await supabase.from("claims").insert({
        activity_id: activityId,
        amount: amount.trim(),
        description: description.trim(),
      });

      if (error) {
        setMessage(
          "Unable to save the draft. Check that the activity is still active."
        );
        return;
      }

      setAmount("");
      setDescription("");
      setMessage("Draft saved successfully.");
    } catch {
      setMessage("Connection failed. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-3xl font-bold">New Expense Claim</h1>

        <p className="mt-2 text-slate-600">
          Save a draft before adding supporting documents.
        </p>

        <Link
          href="/login"
          className="mt-3 inline-block text-sm text-blue-700 underline"
        >
          Sign In
        </Link>

        <button
          type="button"
          onClick={handleLoadActivities}
          disabled={isLoading || isSaving}
          className="mt-6 block rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-50"
        >
          {isLoading ? "Loading..." : "Load Activities"}
        </button>

        <form
          noValidate
          onSubmit={handleSave}
          className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6"
        >
          <div>
            <label htmlFor="activity" className="block font-medium">
              Activity
            </label>

            <select
              id="activity"
              value={activityId}
              onChange={(event) => setActivityId(event.target.value)}
              disabled={isLoading || isSaving}
              className={fieldClass}
            >
              <option value="">Select an activity</option>

              {activities.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="amount" className="block font-medium">
              Amount (RM)
            </label>

            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={isSaving}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="description" className="block font-medium">
              Description
            </label>

            <textarea
              id="description"
              rows={4}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isSaving}
              className={fieldClass}
            />
          </div>

          <button
            type="submit"
            disabled={isSaving || isLoading || !activityId}
            className="w-full rounded-lg bg-blue-700 px-4 py-3 font-medium text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Draft"}
          </button>
        </form>

        <p role="status" className="mt-4 text-sm text-slate-700">
          {message}
        </p>
      </div>
    </main>
  );
}