// Connects the All projects page to the VS Code webview messaging API.
import type { AllProjectsToHost, AllProjectsTransport, HostToAllProjects } from "@labshelf/core";
import { webviewTransport } from "../../../webviewMessaging/index.js";

export function createAllProjectsChannel(): AllProjectsTransport {
  return webviewTransport<AllProjectsToHost, HostToAllProjects>(acquireVsCodeApi());
}
