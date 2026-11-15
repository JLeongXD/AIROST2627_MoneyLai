"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="setup-screen">
      <h1>Something went wrong</h1>
      <p>Your saved data is still in your account. Please try again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
