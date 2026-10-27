// Mounts the shared All projects page over the webview messaging API (entry of dist/projects/projects.js); the extension host answers in writing/projects.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-list.css";
import "@labshelf/core/styles/library-detail.css";
import "@labshelf/core/styles/library-tabs.css";
import "@labshelf/core/styles/library-sidebar.css";
import "@labshelf/core/styles/all-projects.css";
import { findElement, mountAllProjects } from "@labshelf/core/dom";
import type {
  AllProjectsToHost,
  AllProjectsTransport,
  HostToAllProjects,
  PrefsPort,
  ShareClient,
} from "@labshelf/core";
import {
  createWebviewShareClient,
  createWebviewPrefs,
  createWebviewTransport,
} from "../../../webview/index.js";

/** acquireVsCodeApi() may be called once per webview document, so one call serves both. */
function createAllProjectsChannel(): { transport: AllProjectsTransport; prefs: PrefsPort; sharing: ShareClient } {
  const api = acquireVsCodeApi();
  return { transport: createWebviewTransport<AllProjectsToHost, HostToAllProjects>(api), prefs: createWebviewPrefs(api), sharing: createWebviewShareClient(api) };
}

mountAllProjects(findElement("root"), createAllProjectsChannel());
