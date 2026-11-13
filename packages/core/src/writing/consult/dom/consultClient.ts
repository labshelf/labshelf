// The consult port as the DOM code uses it: a client sends a ConsultRequest to the host and gets its ConsultReply.
import type { ConsultReply, ConsultRequest, ConsultValue } from "../consultRequests.js";

export type ConsultClient = (request: ConsultRequest) => Promise<ConsultReply>;

/** Sends `request` and answers the reply's value; an `ok: false` reply rejects with its error sentence, and a client that rejects propagates. */
export async function askConsult(client: ConsultClient, request: ConsultRequest): Promise<ConsultValue> {
  const reply = await client(request);
  if (!reply.ok) { throw new Error(reply.error); }
  return reply.value;
}
