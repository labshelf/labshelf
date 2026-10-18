// Exports the relay Worker module: the HTTP handler as default export and `Room`, the Durable Object of one share.
// PLATFORM: Workers treat runtime exports of the entry module as handlers or Durable Object classes, so other values stay out.
import type { RelayEnv } from "./cloudflareRuntime.js";
import { handleRelayRequest } from "./handleRelayRequest.js";

export { Room } from "./room/index.js";
export type { HibernatingSocket, KvNamespace, RelayEnv, RoomState, SqlCursor, SqlStorage, SqlValue } from "./cloudflareRuntime.js";

export default {
  fetch: (request: Request, env: RelayEnv): Promise<Response> => handleRelayRequest(request, env),
};
