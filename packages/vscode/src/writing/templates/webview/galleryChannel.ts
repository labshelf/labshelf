// Connects the template gallery page to the VS Code webview messaging API.
import type { GalleryTransport, HostToGallery } from "@labshelf/core";

export function createGalleryChannel(): GalleryTransport {
  const api = acquireVsCodeApi();
  return {
    post: (message) => api.postMessage(message),
    subscribe: (handler) => {
      const listener = (event: MessageEvent<unknown>): void => {
        const message = event.data as HostToGallery | null;
        if (message && typeof message === "object" && typeof message.type === "string") { handler(message); }
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}
