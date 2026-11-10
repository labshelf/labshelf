// Mounts the Project chat over the VS Code channel: the host names the shared project the chat belongs to, and the chat itself runs over
// the page channel with the host's server.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/discussions.css";
import "@labshelf/core/styles/project-chat.css";
import { createRemoteProjectChat, type ProjectChatToHost } from "@labshelf/core";
import { findElement, mountProjectChat, showToast } from "@labshelf/core/dom";
import { createWebviewTransport } from "../../../webview/transport.js";

const api = acquireVsCodeApi();
const end = createWebviewTransport<ProjectChatToHost, object>(api);
const chat = mountProjectChat(findElement("root"), { source: null, projectTitle: null });
let shown: string | null = null;
end.subscribe((raw) => {
  const message = raw as { type?: unknown; key?: unknown; title?: unknown };
  if (message.type !== "project" || typeof message.key !== "string") { return; }
  const title = message.title;
  if ((title !== null && typeof title !== "string") || message.key === shown) { return; }
  shown = message.key;
  chat.setProject(title, title === null ? null : createRemoteProjectChat(end, { onError: (text) => { showToast(text, "error"); } }));
});
api.postMessage({ type: "ready" });
