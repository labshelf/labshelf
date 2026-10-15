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
import { $, mountLibraryUi } from "@labshelf/core/dom";
import { createWebviewChannel } from "./index.js";

const { transport, prefs } = createWebviewChannel();
mountLibraryUi($("root"), {
  transport,
  prefs,
  capabilities: {
    textLayer: true, similar: true, reveal: true, openExternal: true,
    fetchMetadata: true,
  },
  labels: {
    addTooltip: "Add PDF or folder here",
    emptyHint: "To import by drag and drop, drop PDF files onto a folder in the LabShelf tree in the sidebar — not onto this panel.",
    revealPaper: "Reveal in Explorer",
  },
});
