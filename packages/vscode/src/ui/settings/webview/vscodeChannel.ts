/** The settings page's channel to the extension host over the VS Code webview messaging API. */
import type { SettingsHostMessage, SettingsWebviewMessage } from "../protocol.js";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

export interface SettingsChannel {
  post(message: SettingsWebviewMessage): void;
  subscribe(handler: (message: SettingsHostMessage) => void): void;
}

export function createSettingsChannel(): SettingsChannel {
  const api = acquireVsCodeApi();
  return {
    post: (message) => api.postMessage(message),
    subscribe: (handler) => {
      window.addEventListener("message", (event: MessageEvent<unknown>) => {
        const message = event.data as SettingsHostMessage | null;
        if (message && typeof message === "object" && message.type === "state") { handler(message); }
      });
    },
  };
}
