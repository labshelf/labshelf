// Mounts the shared Project Search page over the webview messaging API (entry of dist/search/search.js); the extension host answers in writing/search.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/project-search.css";
import { findElement, mountProjectSearch } from "@labshelf/core/dom";
import type { HostToSearch, SearchToHost, SearchTransport } from "@labshelf/core";
import { webviewTransport } from "../../../webview/index.js";

function createSearchChannel(): SearchTransport {
  return webviewTransport<SearchToHost, HostToSearch>(acquireVsCodeApi());
}

mountProjectSearch(findElement("root"), createSearchChannel());
