// Creates the sharing client of a webview page on top of its single VS Code webview API object.
import { createSharingClient, parseSharingReply, type SharingClient } from "@labshelf/core";

export function createWebviewSharingClient(api: { postMessage(message: unknown): void }): SharingClient {
  return createSharingClient({
    post: (message) => api.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<unknown>): void => {
        const reply = parseSharingReply(event.data);
        if (reply) handler(reply);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  });
}
