/** Builds an abort signal that fires after a delay and holds the process open until then. */

// PLATFORM: Node's AbortSignal.timeout does not keep the event loop alive, so a stalled request under it can let a
// CLI exit with the run unsettled; a plain timer fires.
export function deadline(ms: number, reason = "Deadline passed"): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(reason, "TimeoutError")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
