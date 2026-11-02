/**
 * Mounts the shared Details pane over the webview messaging API (entry of dist/library/details.js), with the
 * extension's capabilities. The extension host answers in ui/details.
 */
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-list.css";
import "@labshelf/core/styles/library-detail.css";
import "@labshelf/core/styles/library-tabs.css";
import "@labshelf/core/styles/library-citation-map.css";
import "@labshelf/core/styles/library-sidebar.css";
import "@labshelf/core/styles/all-projects.css";
import "@labshelf/core/styles/editor-area.css";
import { findElement, mountDetails } from "@labshelf/core/dom";
import { libraryUiCapabilities, libraryUiLabels } from "./libraryUiHost.js";
import { createWebviewNoteViewStore, createWebviewPrefs, createWebviewTransport } from "../../webview/index.js";
import type { DetailsToHost, HostToDetails, MessageEnd, PrefsPort, QmdViewStatePort } from "@labshelf/core";

/** acquireVsCodeApi() may be called once per webview document, so one call serves all three. */
function createDetailsChannel(): { transport: MessageEnd<DetailsToHost, HostToDetails>; prefs: PrefsPort; viewState: QmdViewStatePort } {
  const api = acquireVsCodeApi();
  return { transport: createWebviewTransport<DetailsToHost, HostToDetails>(api), prefs: createWebviewPrefs(api), viewState: createWebviewNoteViewStore(api) };
}

const { transport, prefs, viewState } = createDetailsChannel();
mountDetails(findElement("root"), { transport, prefs, viewState, capabilities: libraryUiCapabilities, labels: libraryUiLabels });
