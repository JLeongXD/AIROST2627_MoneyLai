"use client";
import { useSyncExternalStore } from "react";
import { getServerSyncStatus, getSyncStatus, subscribeSyncStatus } from "@/lib/live-sync";

export default function LiveSyncStatus() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getServerSyncStatus);
  if (status === "active") return null;

  return (
    <div className={`sync-status ${status}`} role="status" aria-live="polite">
      <span aria-hidden="true">●</span>
      {status === "offline"
        ? "You are offline. Updates will resume when your connection returns."
        : "Some updates could not be loaded. Displayed data may be outdated; retrying automatically."}
    </div>
  );
}
