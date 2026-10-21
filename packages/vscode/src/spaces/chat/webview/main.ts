// Mounts the shared positioned Research chat surface over the VS Code channel.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/research-chat.css";
import { $, mountResearchChat } from "@labshelf/core/dom";

const api = acquireVsCodeApi();
const chat = mountResearchChat($("root"), { context: null });
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const raw = event.data;
  if (!raw || typeof raw !== "object" || !("type" in raw) || raw.type !== "context" || !("name" in raw)) { return; }
  if (raw.name === null || typeof raw.name === "string") { chat.setContext(raw.name); }
});
api.postMessage({ type: "ready" });
