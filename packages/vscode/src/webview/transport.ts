// Connects a webview page to the extension host through the VS Code webview API: the message channel, the state-backed prefs and the sharing client, all on the page's single API object.
import {
  createShareClient,
  normalizePrefs,
  parseShareReply,
  type LibraryUiPrefs,
  type MessageEnd,
  type PrefsPort,
  type ShareClient,
} from "@labshelf/core";

/** Carries the page's messages to and from the host; it passes messages with a string `type` or a `channel` envelope key. */
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

/** Keeps the pane prefs in the webview state, which survives a hidden panel and a window reload. */
export function createWebviewPrefs(api: VsCodeApi): PrefsPort {
  const state = (): Record<string, unknown> => {
    const raw = api.getState();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  };
  return {
    load: () => normalizePrefs(state()),
    save: (patch: Partial<LibraryUiPrefs>) => api.setState({ ...state(), ...patch }),
  };
}

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

/** acquireVsCodeApi() may be called once per webview document, so one call serves the transport, the prefs and the sharing client. */
export function createWebviewChannel<Out, In extends object>(): { transport: MessageEnd<Out, In>; prefs: PrefsPort; sharing: ShareClient } {
  const api = acquireVsCodeApi();
  return { transport: createWebviewTransport<Out, In>(api), prefs: createWebviewPrefs(api), sharing: createWebviewShareClient(api) };
}
