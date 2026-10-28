// Mounts the shared sync guide page (entry of dist/syncGuide/syncGuide.js); the host opens its links.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/sync-guide.css";
import { syncGuide } from "@labshelf/core";
import { findElement, renderSyncGuide } from "@labshelf/core/dom";

const host = acquireVsCodeApi();
findElement("root").append(renderSyncGuide(syncGuide, { onOpenLink: (url) => host.postMessage({ type: "openLink", url }) }));
