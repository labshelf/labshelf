// Carries a webview page's messages to and from the extension host through the VS Code webview API.
import type { MessageEnd } from "@labshelf/core";

/** @param api The page's single `acquireVsCodeApi()` result, which may be acquired once per webview document. */
export function webviewTransport<Out, In extends { type: string }>(api: VsCodeApi): MessageEnd<Out, In> {
  return {
    post: (message) => api.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<unknown>): void => {
        const message = event.data as In | null;
        if (message && typeof message === "object" && typeof message.type === "string") { handler(message); }
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}
