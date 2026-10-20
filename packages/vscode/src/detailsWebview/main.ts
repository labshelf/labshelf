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
import { $, mountDetails } from "@labshelf/core/dom";
import { libraryUiCapabilities, libraryUiLabels } from "../libraryWebview/index.js";
import { createDetailsChannel } from "./index.js";

const { transport, prefs } = createDetailsChannel();
mountDetails($("root"), { transport, prefs, capabilities: libraryUiCapabilities, labels: libraryUiLabels });
