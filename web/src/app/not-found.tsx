import Link from "next/link";
export default function NotFound() {
  return (
    <main className="setup-screen">
      <h1>Page not found</h1>
      <p>This page may have moved.</p>
      <Link href="/dashboard">Return to MoneyLai</Link>
    </main>
  );
}
