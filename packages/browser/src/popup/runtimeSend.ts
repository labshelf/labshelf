// Popup's typed request to the background that unwraps the reply envelope, and an error-to-text helper.
import { bx } from "../platform/browserApi";
import type { RuntimeMessage, RuntimeResponse } from "../platform/runtimeMessages";

export async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
