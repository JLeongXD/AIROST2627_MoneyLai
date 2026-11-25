"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/domain";
import type { Profile } from "@/lib/types";
import { Icon } from "./Creative";
export function WorkspaceFrame({
  profile,
  children,
  onSignOut,
  signingOut = false,
}: {
  profile: Profile;
  children: ReactNode;
  onSignOut: () => void;
  signingOut?: boolean;
}) {
  const path = usePathname();
  const role = {
    member: "Member",
    treasurer: "Treasurer",
    president: "President",
  }[profile.role];
  const links = [
    {
      href: profile.role === "president" ? "/president" : "/dashboard",
      label: "Overview",
      icon: "grid",
    },
    { href: "/claims", label: "My claims", icon: "receipt" },
    ...(profile.role === "treasurer"
      ? [{ href: "/treasury", label: "Review desk", icon: "wallet" }]
      : []),
    { href: "/activities", label: "Activities", icon: "activity" },
    { href: "/profile", label: "Profile", icon: "user" },
  ];
  return (
    <div className="hybrid-app" data-role={profile.role}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="global-nav">
        <div className="nav-inner">
          <Link className="hybrid-brand" href={links[0].href}>
            <span>M</span>MoneyLai<i>.</i>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={
                  path === l.href || path.startsWith(l.href + "/")
                    ? "page"
                    : undefined
                }
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="nav-account">
            <span className="role-pill">{role}</span>
            <details className="profile-menu">
              <summary aria-label="Account menu">
                <span className="profile-avatar">
                  {profile.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile-name">
                  {profile.display_name.split(" ")[0]}
                </span>
                <span>⌄</span>
              </summary>
              <div className="profile-popover">
                <strong>{profile.display_name}</strong>
                <small>{role} workspace</small>
                <Link href="/profile">Profile & payout details</Link>
                <button disabled={signingOut} onClick={onSignOut}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>
      <div className="workspace-context">
        <span>Club Finance, Simplified.</span>
        <span>Every Ringgit. Every Receipt. Every Decision.</span>
      </div>
      <main id="main-content" className="page-content hybrid-content">
        {children}
      </main>
      <footer className="hybrid-footer">
        <span>MoneyLai © {new Date().getFullYear()}</span>
        <span>A little clarity for every club expense.</span>
      </footer>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={
              path === l.href || path.startsWith(l.href + "/")
                ? "page"
                : undefined
            }
          >
            <Icon name={l.icon} size={20} />
            <span>{l.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, profile, ready, error } = useAuth();
  const router = useRouter();
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
      <div className="loading-screen" role="status">
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
  return (
    <WorkspaceFrame
      profile={profile}
      onSignOut={signOut}
      signingOut={signingOut}
    >
      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
      {children}
    </WorkspaceFrame>
  );
}
