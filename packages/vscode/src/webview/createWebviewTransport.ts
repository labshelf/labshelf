// Carries a webview page's messages to and from the extension host through the VS Code webview API; it passes messages with a string `type` or a `channel` envelope key.
import type { MessageEnd } from "@labshelf/core";

/** @param api The page's single `acquireVsCodeApi()` result, which may be acquired once per webview document. */
export function createWebviewTransport<Out, In extends object>(api: VsCodeApi): MessageEnd<Out, In> {
  return {
    post: (message) => api.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<unknown>): void => {
        const message = event.data as Record<string, unknown> | null;
        if (message && typeof message === "object" && (typeof message.type === "string" || "channel" in message)) {
          handler(message as In);
        }
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}
