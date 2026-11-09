// Mounts the Project chat preview over the VS Code channel, with an in-memory demo chat for each project the host names.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/discussions.css";
import "@labshelf/core/styles/project-chat.css";
import { createDemoProjectChat } from "@labshelf/core";
import { findElement, mountProjectChat } from "@labshelf/core/dom";

const api = acquireVsCodeApi();
const chat = mountProjectChat(findElement("root"), { source: null, projectTitle: null });
let shown: string | null = null;
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const raw = event.data;
  if (!raw || typeof raw !== "object" || !("type" in raw) || raw.type !== "project" || !("title" in raw)) { return; }
  const title = raw.title;
  if ((title !== null && typeof title !== "string") || title === shown) { return; }
  shown = title;
  // TODO(project chat backend): the author becomes the collab user name, the source the project's .labshelf/chat.qmd.
  chat.setProject(title, title === null ? null : createDemoProjectChat({ projectTitle: title, author: "You" }));
});
api.postMessage({ type: "ready" });
