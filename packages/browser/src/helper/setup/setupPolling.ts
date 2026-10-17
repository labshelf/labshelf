// Runs a callback every few seconds while the page is visible, pausing when it is hidden.
const POLL_INTERVAL_MS = 3000;

export interface Polling { stop(): void }

export function startPolling(tick: () => void): Polling {
  let timer: ReturnType<typeof setInterval> | undefined;
  const sync = (): void => {
    const visible = document.visibilityState === "visible";
    if (visible && timer === undefined) { timer = setInterval(tick, POLL_INTERVAL_MS); }
    if (!visible && timer !== undefined) { clearInterval(timer); timer = undefined; }
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return {
    stop() {
      document.removeEventListener("visibilitychange", sync);
      if (timer !== undefined) { clearInterval(timer); timer = undefined; }
    },
  };
}
