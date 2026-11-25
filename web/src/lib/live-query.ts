// Serialize refreshes so slower requests cannot overwrite newer results.
export function createLiveQuery<T>(load: () => Promise<T>, onData: (data: T) => void, onError: (error: unknown) => void) {
  let active = true;
  let running = false;
  let queued = false;
  async function refresh() {
    if (!active) return;
    if (running) { queued = true; return; }
    running = true;
    try {
      const data = await load();
      if (active) onData(data);
    } catch (error) {
      if (active) onError(error);
    } finally {
      running = false;
      if (active && queued) { queued = false; void refresh(); }
    }
  }
  return { refresh, stop() { active = false; queued = false; } };
}
