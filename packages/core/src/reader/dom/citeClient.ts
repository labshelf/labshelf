// Asks the host the cite popup's questions over the reader bridge and settles each with the cite.reply of the same requestId.
import type { CiteReply, CiteRequest } from "../../writing/citations/index.js";
import { isCiteReplyMessage } from "../protocol/index.js";
import type { HostBridge } from "./readerSession.js";

export interface CiteClient {
  request(request: CiteRequest): Promise<CiteReply>;
}

const clients = new WeakMap<HostBridge, CiteClient>();

/** The cite client of a bridge; one client and one reply handler per bridge, since HostBridge handlers are never removed. */
export function readerCiteClient(host: HostBridge): CiteClient {
  const known = clients.get(host);
  if (known) { return known; }
  const pending = new Map<string, (reply: CiteReply) => void>();
  const prefix = Math.random().toString(36).slice(2, 10);
  let counter = 0;
  host.on("cite.reply", (message) => {
    if (!isCiteReplyMessage(message)) { return; }
    const settle = pending.get(message.requestId);
    if (!settle) { return; }
    pending.delete(message.requestId);
    settle(message.reply);
  });
  const client: CiteClient = {
    request: (request) => new Promise<CiteReply>((resolve) => {
      counter += 1;
      const requestId = `cite-${prefix}-${counter}`;
      pending.set(requestId, resolve);
      host.post({ command: "cite", requestId, request });
    }),
  };
  clients.set(host, client);
  return client;
}
