/** A typed request from the options page to the background that unwraps the reply envelope. */
import { bx, type RuntimeMessage, type RuntimeResponse } from "../platform";

export async function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  const reply = (await bx.runtime.sendMessage(message)) as RuntimeResponse;
  if (!reply.ok) throw new Error(reply.error);
  return reply.data as T;
}
