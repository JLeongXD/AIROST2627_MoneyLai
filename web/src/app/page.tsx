"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type Claim = {
  id: string;
  activityName: string;
  amount: number;
  description: string;
};

export default function Home() {
  const [amount, setAmount] = useState(""); //useState-React 用来记住网页当前数据的地方。
  const [description, setDescription] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [error, setError] = useState("");
  const [activityName, setActivityName] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activityName.trim()) {
      setError("Please enter an activity name.");
      return;
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Please enter an amount greater than 0.");
      return;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
      setError("Please enter an amount with up to two decimal places.");
      return;
    }

    if (!description.trim()) {
      setError("Please enter a description.");
      return;
    }

    const claimData: Claim = {
      id: editingId ?? crypto.randomUUID(),
      activityName: activityName.trim(),
      amount: numericAmount,
      description: description.trim(),
    };

    if (editingId !== null) {
      setClaims((previousClaims) =>
        previousClaims.map((claim) =>
          claim.id === editingId ? claimData : claim
        )
      );
    } else {
      setClaims((previousClaims) => [claimData, ...previousClaims]);
    }

    setEditingId(null);
    setActivityName("");
    setAmount("");
    setDescription("");
    setError("");
    setStorageMessage("Changes are not saved locally yet.");
  }

  function handleDelete(claimId: string) {
    setClaims((previousClaims) =>
      previousClaims.filter((claim) => claim.id !== claimId)
    );

    if (editingId === claimId) {
      handleCancelEdit();
    }

    setStorageMessage("Changes are not saved locally yet.");
  }

  function handleSave() {
  try {
    const claimsJSON = JSON.stringify(claims);

    localStorage.setItem("moneylai-claims", claimsJSON);

    setStorageMessage("Claims saved in this browser.");
  } catch {
    setStorageMessage("Unable to save claims. Please try again.");
  }
  }

  function handleLoad() {
    try {
      const savedClaims = localStorage.getItem("moneylai-claims");

      if (savedClaims === null) {
        setStorageMessage("No saved claims found.");
        return;
      }

      const parsedClaims = JSON.parse(savedClaims);

      const isValid =
        Array.isArray(parsedClaims) &&
        parsedClaims.every(
          (claim) =>
            claim !== null &&
            typeof claim === "object" &&
            typeof claim.id === "string" &&
            typeof claim.activityName === "string" &&
            typeof claim.amount === "number" &&
            Number.isFinite(claim.amount) &&
            claim.amount > 0 &&
            typeof claim.description === "string"
        );

      if (!isValid) {
        setStorageMessage("The saved data is invalid.");
        return;
      }

      setClaims(parsedClaims);
      setStorageMessage("Saved claims loaded.");
    } catch {
      setStorageMessage("Unable to load saved claims.");
    }
  }

  function handleEdit(claim: Claim) {
    setEditingId(claim.id);

    setActivityName(claim.activityName);
    setAmount(claim.amount.toString());
    setDescription(claim.description);

    setError("");
    setStorageMessage("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function handleCancelEdit() {
    setEditingId(null);

    setActivityName("");
    setAmount("");
    setDescription("");

    setError("");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-xl">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">MoneyLai</h1>

          <p className="mt-2 text-slate-600">
            Submit and track your club expense claims.
          </p>
        </header>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">
            {editingId !== null ? "Edit Expense Claim" : "New Expense Claim"}
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Enter the amount you paid and describe the expense.
          </p>

          <form
            noValidate
            onSubmit={handleSubmit}
            className="mt-6 space-y-5"
          >
            <div>
              <label
                htmlFor="activityName"
                className="block text-sm font-medium"
              >
                Activity Name
              </label>

              <input
                id="activityName"
                name="activityName"
                type="text"
                required
                maxLength={100}
                value={activityName}
                onChange={(event) => setActivityName(event.target.value)}
                placeholder="e.g. Robotics Workshop"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="amount"
                className="block text-sm font-medium"
              >
                Amount (RM)
              </label>

              <input
                id="amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="e.g. 120.00"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium"
              >
                Description
              </label>

              <textarea
                id="description"
                name="description"
                required
                rows={4}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="e.g. Materials for the robotics workshop"
                className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 outline-none placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />

              <p className="mt-1 text-xs text-slate-500">
                Maximum 500 characters.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                className="flex-1 rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800"
              >
                {editingId !== null ? "Update Claim" : "Submit Claim"}
              </button>

              {editingId !== null && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="rounded-lg border border-slate-300 px-4 py-3 font-medium hover:bg-slate-100"
                >
                  Cancel
                </button>
              )}
            </div>

          </form>
        </section>

        <section className="mt-8" aria-labelledby="claims-heading">
          <div className="flex items-center justify-between">
            <h2 id="claims-heading" className="text-xl font-semibold">
              My Claims
            </h2>

            <span className="text-sm text-slate-500">
              {claims.length} {claims.length === 1 ? "claim" : "claims"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
            >
              Save Locally
            </button>

            <button
              type="button"
              onClick={handleLoad}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100"
            >
              Load Saved Claims
            </button>
          </div>

          <p role="status" className="mt-3 text-sm text-slate-600">
            {storageMessage}
          </p>

          {claims.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <p className="font-medium text-slate-600">No claims yet.</p>

              <p className="mt-1 text-sm text-slate-500">
                Submit your first expense using the form above.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {claims.map((claim) => (
                <li
                  key={claim.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleEdit(claim)}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(claim.id)}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>

                  <p className="mb-1 text-sm font-medium text-blue-700">
                    {claim.activityName}
                  </p>

                  <p className="text-lg font-semibold">
                    RM {claim.amount.toFixed(2)}
                  </p>

                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">
                    {claim.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-center text-xs text-slate-500">
          Practice mode: Claims are stored temporarily. Click "Save Locally"
          to keep them in this browser and "Load Saved Claims" to restore them.
        </p>
      </div>
    </main>
  );
}