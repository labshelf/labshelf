// Connects the library UI's channel and prefs to the VS Code webview API.
import type { HostToUi, LibraryTransport, PrefsPort, ShareClient, UiToHost } from "@labshelf/core";

import { createWebviewShareClient, createWebviewPrefs, createWebviewTransport } from "../../webview/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createWebviewChannel(): { transport: LibraryTransport; prefs: PrefsPort; sharing: ShareClient } {
  const api = acquireVsCodeApi();
  return { transport: createWebviewTransport<UiToHost, HostToUi>(api), prefs: createWebviewPrefs(api), sharing: createWebviewShareClient(api) };
}
