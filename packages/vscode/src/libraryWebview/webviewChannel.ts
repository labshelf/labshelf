/**
 * Connects the library UI's channel and prefs to the VS Code webview API: messages go through postMessage and the
 * window "message" event, prefs live in the webview state, which survives a hidden panel and a window reload.
 */
import { sanitizePrefs, type HostToUi, type LibraryTransport, type LibraryUiPrefs, type PrefsPort, type UiToHost } from "@labshelf/core";

import { webviewTransport } from "../webviewMessaging/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createWebviewChannel(): { transport: LibraryTransport; prefs: PrefsPort } {
  const api = acquireVsCodeApi();
  const state = (): Record<string, unknown> => {
    const raw = api.getState();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  };
  const transport: LibraryTransport = webviewTransport<UiToHost, HostToUi>(api);
  const prefs: PrefsPort = {
    load: () => sanitizePrefs(state()),
    save: (patch: Partial<LibraryUiPrefs>) => api.setState({ ...state(), ...patch }),
  };
  return { transport, prefs };
}
