// Mounts the shared Project Search page over the webview messaging API (entry of dist/search/search.js); the extension host answers in writing/search.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/project-search.css";
import { $, mountProjectSearch } from "@labshelf/core/dom";
import { createSearchChannel } from "./searchChannel.js";

mountProjectSearch($("root"), createSearchChannel());
