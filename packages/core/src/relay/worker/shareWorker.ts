// Exports the share Worker module: the handler of the paper share endpoints and `/version` as default export, and `Mirror`, the
// remote library's Durable Object, which the relay binds by script name. It is a separate Worker from the relay, never rotated,
// so public links and the remote library survive a relay rotation.
// PLATFORM: Workers treat runtime exports of the entry module as handlers or Durable Object classes, so other values stay out.
import type { ShareEnv } from "./cloudflareRuntime.js";
import { answerShareRequest } from "./answerRelayRequest.js";

export { Mirror } from "./mirror.js";

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export default {
  fetch: (request: Request, env: ShareEnv): Promise<Response> => answerShareRequest(request, env),
};
