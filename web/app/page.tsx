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

    const newClaim: Claim = {
      id: crypto.randomUUID(),
      activityName: activityName.trim(),
      amount: numericAmount,
      description: description.trim(),
    };

    setClaims((previousClaims) => [newClaim, ...previousClaims]);

    setActivityName("");
    setAmount("");
    setDescription("");
    setError("");
  }

  function handleDelete(claimId: string) {
    setClaims((previousClaims) =>
      previousClaims.filter((claim) => claim.id !== claimId)
    );
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
          <h2 className="text-xl font-semibold">New Expense Claim</h2>

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

            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Submit Claim
            </button>
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
                  <button
                    type="button"
                    onClick={() => handleDelete(claim.id)}
                    className="mt-4 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                  >
                    Delete
                  </button>

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
          Practice mode: claims are stored temporarily and will be cleared
          when you refresh this page.
        </p>
      </div>
    </main>
  );
}