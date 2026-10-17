// Connects the All projects page and its pane prefs to the VS Code webview API.
import type { AllProjectsToHost, AllProjectsTransport, HostToAllProjects, PrefsPort } from "@labshelf/core";
import { webviewPrefs, webviewTransport } from "../../../webviewMessaging/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
export function createAllProjectsChannel(): { transport: AllProjectsTransport; prefs: PrefsPort } {
  const api = acquireVsCodeApi();
  return { transport: webviewTransport<AllProjectsToHost, HostToAllProjects>(api), prefs: webviewPrefs(api) };
}
