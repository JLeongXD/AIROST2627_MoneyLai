// Poll existing RLS/RPC endpoints, including role-restricted summaries.
// No raw financial data is broadcast or exposed by a new database policy.
export const SYNC_INTERVAL_MS = 5_000;
const refreshers = new Set<() => void>();
const statusListeners = new Set<() => void>();
const failures = new Set<object>();
let detach: (() => void) | undefined;
function notifyStatus() { statusListeners.forEach((listener) => listener()); }
function refreshVisible() {
  notifyStatus();
  if (document.visibilityState !== "hidden" && navigator.onLine) refreshers.forEach((refresh) => refresh());
}
export function subscribeToRefresh(refresh: () => void) {
  refreshers.add(refresh);
  if (!detach) {
    const timer = window.setInterval(refreshVisible, SYNC_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    window.addEventListener("offline", notifyStatus);
    detach = () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      window.removeEventListener("offline", notifyStatus);
    };
  }
  return () => {
    refreshers.delete(refresh);
    if (!refreshers.size) { detach?.(); detach = undefined; }
  };
}
export function reportSyncFailure(query: object, failed: boolean) {
  if (failed) failures.add(query); else failures.delete(query);
  notifyStatus();
}
export function subscribeSyncStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}
export function getSyncStatus() {
  if (!navigator.onLine) return "offline";
  return failures.size ? "delayed" : "active";
}
export function getServerSyncStatus() { return "active"; }
