// Exports the share Worker module: the handler of the paper share endpoints as default export. It is a separate Worker from the
// relay, never rotated, so public links keep working when the relay Worker is replaced.
// PLATFORM: Workers treat runtime exports of the entry module as handlers or Durable Object classes, so other values stay out.
import type { ShareEnv } from "./cloudflareRuntime.js";
import { answerShareRequest } from "./answerRelayRequest.js";

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
export default {
  fetch: (request: Request, env: ShareEnv): Promise<Response> => answerShareRequest(request, env),
};
