"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FormEvent } from "react";

export default function EditClaimPage() {
  const { id } = useParams<{ id: string }>();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadClaim() {
      try {
        const supabase = createClient();

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (!isActive) return;

        if (authError || !user) {
          setError("Please sign in to edit your claim.");
          return;
        }

        const { data, error: queryError } = await supabase
          .from("claims")
          .select("id, amount, description")
          .eq("id", id)
          .eq("claimant_id", user.id)
          .eq("status", "draft")
          .maybeSingle();

        if (!isActive) return;

        if (queryError) {
          console.error("Failed to load draft:", queryError);
          setError("Unable to load the draft. Please try again.");
          return;
        }

        if (!data) {
          setError(
            "This draft is unavailable or you do not have permission to edit it."
          );
          return;
        }

        setAmount(String(data.amount));
        setDescription(data.description);
      } catch (loadError) {
        if (!isActive) return;

        console.error("Failed to connect:", loadError);
        setError("Connection failed. Please try again.");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadClaim();

    return () => {
      isActive = false;
    };
  }, [id]);

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();

      if (isSaving) return;

      setSaveMessage("");

      const numericAmount = Number(amount);

      if (
          !/^\d+(\.\d{1,2})?$/.test(amount.trim()) ||
          !Number.isFinite(numericAmount) ||
          numericAmount <= 0
      ) {
          setSaveMessage(
          "Please enter a positive amount with up to two decimal places."
          );
          return;
      }

      if (
          description.trim().length === 0 ||
          description.trim().length > 500
      ) {
          setSaveMessage("Please enter a description of 1 to 500 characters.");
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
          setSaveMessage("Please sign in before updating your claim.");
          return;
          }

          const { data, error: updateError } = await supabase
          .from("claims")
          .update({
              amount: amount.trim(),
              description: description.trim(),
          })
          .eq("id", id)
          .eq("claimant_id", user.id)
          .eq("status", "draft")
          .select("id")
          .maybeSingle();

          if (updateError) {
          console.error("Failed to update draft:", updateError);
          setSaveMessage("Unable to update the draft. Please try again.");
          return;
          }

          if (!data) {
          setSaveMessage(
              "The draft could not be updated. It may no longer be editable."
          );
          return;
          }

          setSaveMessage("Draft updated successfully.");
      } catch (updateError) {
          console.error("Failed to connect:", updateError);
          setSaveMessage("Connection failed. Please try again.");
      } finally {
          setIsSaving(false);
      }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-3xl font-bold">Edit Claim</h1>

        <Link
          href="/claims"
          className="mt-3 inline-block text-sm text-blue-700 underline"
        >
          Back to My Claims
        </Link>

        {isLoading ? (
          <p role="status" className="mt-6">
            Loading your draft...
          </p>
        ) : error ? (
          <p role="alert" className="mt-6 text-red-600">
            {error}
          </p>
        ) : (
          <form
            noValidate
            onSubmit={handleUpdate}
            className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6"
            >
            <div>
              <label
                htmlFor="amount"
                className="block font-medium"
              >
                Amount (RM)
              </label>

              <input
                disabled={isSaving}
                id="amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-300 p-3"
              />
            </div>

            <div>
              <label
                htmlFor="description"
                className="block font-medium"
              >
                Description
              </label>

              <textarea
                disabled={isSaving}
                id="description"
                rows={4}
                maxLength={500}
                value={description}
                onChange={(event) =>
                  setDescription(event.target.value)
                }
                className="mt-2 w-full rounded-lg border border-slate-300 p-3"
              />
            </div>

            <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-lg bg-blue-700 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                {isSaving ? "Updating..." : "Update Claim"}
            </button>

            <p role="status" className="text-sm text-slate-700">
                {saveMessage}
            </p>
          </form>
        )}
      </div>
    </main>
  );
}