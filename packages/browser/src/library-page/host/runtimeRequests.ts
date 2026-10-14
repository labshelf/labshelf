/**
 * Requests from the library page to the background: a typed send that unwraps the reply envelope, and the
 * fire-and-forget nudge that coalesces a sync after a local change.
 */
import { bx, type RuntimeMessage, type RuntimeResponse } from "../../platform";

/** Sends a runtime message and returns its data, or throws the background's error. */
export async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

/** Asks the background to sync soon; the background logs its own failures, so the page does not wait. */
export function scheduleSyncSoon(reason: string): void {
  void send({ type: "sync.scheduleSoon", reason }).catch(() => undefined);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
