// Exports the relay Worker module: the HTTP handler as default export and `Room`, the Durable Object of one share.
// PLATFORM: Workers treat runtime exports of the entry module as handlers or Durable Object classes, so other values stay out.
import type { RelayEnv } from "./cloudflareRuntime.js";
import { answerRelayRequest } from "./answerRelayRequest.js";

export { Room } from "./room.js";
export type { HibernatingConnection, KvNamespace, RelayEnv, RoomState, CloudflareCursorLike, SqlField } from "./cloudflareRuntime.js";

export default {
  fetch: (request: Request, env: RelayEnv): Promise<Response> => answerRelayRequest(request, env),
};
