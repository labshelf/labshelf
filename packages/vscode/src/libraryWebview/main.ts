/**
 * VS Code entry of the library list bundle (dist/library/library.js): mounts the shared library UI over the webview
 * messaging API with the extension's capabilities. The extension host answers in ui/list.
 */
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-list.css";
import "@labshelf/core/styles/library-detail.css";
import "@labshelf/core/styles/library-tabs.css";
import "./page.css";
import { $, mountLibraryUi } from "@labshelf/core/dom";
import { createWebviewChannel } from "./index.js";

const { transport, prefs } = createWebviewChannel();
mountLibraryUi($("root"), {
  transport,
  prefs,
  capabilities: {
    paperData: true, editTags: true, editNote: true, textLayer: true, similar: true, reveal: true, openExternal: true,
    fetchMetadata: true, exportAnnotations: true,
  },
  labels: {
    addTooltip: "Add PDF or folder here",
    emptyHint: "To import by drag and drop, drop PDF files onto a folder in the LabShelf tree in the sidebar — not onto this panel.",
    revealPaper: "Reveal in Explorer",
  },
});
