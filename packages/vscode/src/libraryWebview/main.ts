/**
 * Mounts the shared library UI over the webview messaging API (entry of dist/library/library.js), with the
 * extension's capabilities. The extension host answers in ui/list.
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
import { $, mountLibraryUi } from "@labshelf/core/dom";
import { createWebviewChannel, libraryUiCapabilities, libraryUiLabels } from "./index.js";

const { transport, prefs, sharing } = createWebviewChannel();
mountLibraryUi($("root"), { transport, prefs, sharing, capabilities: libraryUiCapabilities, labels: libraryUiLabels });
