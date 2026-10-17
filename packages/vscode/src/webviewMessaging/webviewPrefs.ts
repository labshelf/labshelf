// Keeps a webview page's pane prefs in the webview state, which survives a hidden panel and a window reload.
import { sanitizePrefs, type LibraryUiPrefs, type PrefsPort } from "@labshelf/core";

/** @param api The page's single `acquireVsCodeApi()` result, shared with its transport. */
export function webviewPrefs(api: VsCodeApi): PrefsPort {
  const state = (): Record<string, unknown> => {
    const raw = api.getState();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  };
  return {
    load: () => sanitizePrefs(state()),
    save: (patch: Partial<LibraryUiPrefs>) => api.setState({ ...state(), ...patch }),
  };
}
