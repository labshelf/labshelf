/**
 * Sends the library page's requests to the background: a typed send that unwraps the reply envelope, and the
 * fire-and-forget nudge that coalesces a sync after a local change.
 */
import { BrowserLogger, bx, type RuntimeMessage, type RuntimeResponse } from "../../platform";

const log = new BrowserLogger("library-page");

/** Sends a runtime message and returns its data, or throws the background's error. */
export async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Asks the background to sync soon; the page does not wait and logs a request that failed. */
export function scheduleSyncSoon(reason: string): void {
  void send({ type: "sync.scheduleSoon", reason }).catch((error: unknown) =>
    log.warn("Sync request was not accepted", { reason, message: errorMessage(error) }),
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
