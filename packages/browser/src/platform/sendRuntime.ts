// Sends a typed request to the background and unwraps the reply envelope, throwing the background's error text.
import { bx } from "./browserApi";
import type { RuntimeMessage, RuntimeResponse } from "./messages";

export async function sendRuntime<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}
