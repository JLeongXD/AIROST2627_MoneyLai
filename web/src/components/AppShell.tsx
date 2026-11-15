"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/domain";
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, ready, error } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (ready && !user && !error) router.replace("/login");
  }, [ready, user, error, router]);
  async function signOut() {
    setSigningOut(true);
    setMessage("");
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.replace("/login");
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setSigningOut(false);
    }
  }
  if (!ready)
    return (
      <div className="loading-screen">
        <span className="spinner" />
        Opening MoneyLai…
      </div>
    );
  if (error || !profile)
    return (
      <main className="setup-screen">
        <h1>Account unavailable</h1>
        <p>{error || "Redirecting to sign in…"}</p>
        <Link href="/login">Go to sign in</Link>
        {user && <button onClick={signOut}>Sign out</button>}
      </main>
    );
  const links = [
    { href: "/dashboard", label: "Overview", icon: "◈" },
    { href: "/claims", label: "My claims", icon: "▤" },
    { href: "/activities", label: "Activities", icon: "▦" },
    ...(profile.role === "treasurer"
      ? [{ href: "/treasury", label: "Treasury", icon: "◎" }]
      : []),
    { href: "/profile", label: "My profile", icon: "◉" },
  ];
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">M</span>MoneyLai
          <span className="brand-dot">.</span>
        </Link>
        <span className="nav-label">CLUB FINANCE, SIMPLIFIED</span>
        <nav aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={
                path === link.href || path.startsWith(link.href + "/")
                  ? "page"
                  : undefined
              }
              className={`nav-item ${path === link.href || path.startsWith(link.href + "/") ? "active" : ""}`}
            >
              <span aria-hidden>{link.icon}</span>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>ONE LESS THING TO CHASE</span>
          <p>
            Clear budgets.
            <br />
            Every claim accounted for.
          </p>
        </div>
        <div className="account">
          <span className="avatar">
            {profile.display_name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{profile.display_name}</strong>
            <small>
              {profile.role === "treasurer" ? "Treasurer" : "Club member"}
            </small>
          </div>
          <button
            className="icon-button"
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
          >
            ↗
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="workspace-label">MoneyLai workspace</span>
          <span className="role-tag">
            {profile.role === "treasurer"
              ? "Treasurer access"
              : "Member access"}
          </span>
        </header>
        {message && (
          <p className="notice error" role="alert">
            {message}
          </p>
        )}
        <main className="page-content">{children}</main>
        <footer className="site-footer">
          MoneyLai · Club budget & expense management
        </footer>
      </div>
    </div>
  );
}
