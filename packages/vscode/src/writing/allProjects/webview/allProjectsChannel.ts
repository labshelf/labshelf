// Connects the All projects page and its pane prefs to the VS Code webview API.
import type { AllProjectsToHost, AllProjectsTransport, HostToAllProjects, PrefsPort, SharingClient } from "@labshelf/core";
import { createWebviewSharingClient, webviewPrefs, webviewTransport } from "../../../webview/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createAllProjectsChannel(): { transport: AllProjectsTransport; prefs: PrefsPort; sharing: SharingClient } {
  const api = acquireVsCodeApi();
  return { transport: webviewTransport<AllProjectsToHost, HostToAllProjects>(api), prefs: webviewPrefs(api), sharing: createWebviewSharingClient(api) };
}
