// Connects the library UI's channel and prefs to the VS Code webview API.
import type { HostToUi, LibraryTransport, PrefsPort, SharingClient, UiToHost } from "@labshelf/core";

import { createWebviewSharingClient, webviewPrefs, webviewTransport } from "../webviewMessaging/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createWebviewChannel(): { transport: LibraryTransport; prefs: PrefsPort; sharing: SharingClient } {
  const api = acquireVsCodeApi();
  return { transport: webviewTransport<UiToHost, HostToUi>(api), prefs: webviewPrefs(api), sharing: createWebviewSharingClient(api) };
}
