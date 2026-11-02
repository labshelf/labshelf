// Exports the relay Worker module: the HTTP handler as default export, `Room`, the Durable Object of one share, and `Inbox`, the owner's inbox.
// PLATFORM: Workers treat runtime exports of the entry module as handlers or Durable Object classes, so other values stay out.
import type { RelayEnv } from "./cloudflareRuntime.js";
import { answerRelayRequest } from "./answerRelayRequest.js";

export { Room } from "./room.js";
export { Inbox } from "./inbox.js";
export type {
  HibernatingConnection, InboxState, KvNamespace, RelayEnv, RoomState, CloudflareCursorLike, SqlField,
} from "./cloudflareRuntime.js";

export default {
  fetch: (request: Request, env: RelayEnv): Promise<Response> => answerRelayRequest(request, env),
};
