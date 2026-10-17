// Mounts the shared project history page over the webview messaging API (entry of dist/history/history.js); the extension host answers in writing/history.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/project-history.css";
import { $, mountProjectHistory } from "@labshelf/core/dom";
import { createHistoryChannel } from "./historyChannel.js";

mountProjectHistory($("root"), createHistoryChannel());
