// Sends the popup's typed request to the background, unwraps the reply envelope, and turns errors into text.
import { bx } from "../platform";
import type { RuntimeMessage, RuntimeResponse } from "../platform";

export async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
