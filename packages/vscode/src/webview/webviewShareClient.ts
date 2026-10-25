// Creates the sharing client of a webview page on top of its single VS Code webview API object.
import { createShareClient, parseShareReply, type ShareClient } from "@labshelf/core";

export function createWebviewShareClient(api: { postMessage(message: unknown): void }): ShareClient {
  return createShareClient({
    post: (message) => api.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<unknown>): void => {
        const reply = parseShareReply(event.data);
        if (reply) handler(reply);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  });
}
