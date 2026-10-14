/**
 * The library UI's channel and prefs over the VS Code webview API: messages go through postMessage and the window
 * "message" event, prefs live in the webview state, which survives a hidden panel and a window reload.
 */
import { sanitizePrefs, type HostToUi, type LibraryTransport, type LibraryUiPrefs, type PrefsPort } from "@labshelf/core";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createWebviewChannel(): { transport: LibraryTransport; prefs: PrefsPort } {
  const api = acquireVsCodeApi();
  const state = (): Record<string, unknown> => {
    const raw = api.getState();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  };
  const transport: LibraryTransport = {
    post: (m) => api.postMessage(m),
    subscribe: (handler) => {
      const listener = (ev: MessageEvent<unknown>): void => {
        const m = ev.data as HostToUi | null;
        if (m && typeof m === "object" && typeof m.type === "string") handler(m);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
  const prefs: PrefsPort = {
    load: () => sanitizePrefs(state()),
    save: (patch: Partial<LibraryUiPrefs>) => api.setState({ ...state(), ...patch }),
  };
  return { transport, prefs };
}
