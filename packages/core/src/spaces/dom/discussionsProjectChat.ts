// Lists the Project chats of the shared projects a Space links, under the Space chat, and opens one in the Discussions over the Spaces channel.
import { renderElement, showToast } from "../../ui/dom/index.js";
import { createRemoteProjectChat } from "../../projectChat/projectChatProtocol.js";
import { mountProjectChat } from "../../projectChat/dom/mountProjectChat.js";
import type { SpaceProjectEntry } from "../spaceViews.js";
import type { SpacesTransport } from "../spacesProtocol.js";
import type { SpaceSnapshot } from "./mountOverview.js";
import { renderIconButton, renderIconSpan } from "./discussionsViews.js";

/** A Project chat open in the Discussions. */
export interface OpenProjectChat {
  readonly projectId: string;
  readonly node: HTMLElement;
  /** Unmounts the chat and tells the host to stop serving it. */
  dispose(): void;
}

/** The linked projects with a chat, in the Space's order. */
export function linkedChatProjects(data: SpaceSnapshot): SpaceProjectEntry[] {
  return data.space.projects.flatMap(id => data.projects.filter(project => project.projectId === id && project.hasChat));
}

/** One row per project chat; nothing when the Space links no shared project. */
export function renderProjectChatRows(projects: readonly SpaceProjectEntry[], selected: string | undefined, open: (project: SpaceProjectEntry) => void): HTMLElement | "" {
  if (!projects.length) return "";
  return renderElement("ul", { class: "ds-rows ds-project-chats", "aria-label": "Project chats" }, ...projects.map(project => {
    const button = renderElement("button", { type: "button", class: "ds-row", "data-project": project.projectId, "aria-current": project.projectId === selected ? "true" : undefined },
      renderIconSpan("users"),
      renderElement("span", { class: "ds-row-title" }, renderElement("strong", { text: project.title }), renderElement("span", { text: "Project chat" })));
    button.addEventListener("click", () => open(project));
    return renderElement("li", {}, button);
  }));
}

/** Asks the host to serve the project's chat, then mounts it with a back button; the open is posted before the chat asks for its messages. */
export function openSpaceProjectChat(end: SpacesTransport, spaceId: string, project: SpaceProjectEntry, back: () => void): OpenProjectChat {
  end.post({ type: "openProjectChat", spaceId, projectId: project.projectId });
  const backButton = renderIconButton("arrow-left", "All conversations", "ds-icon-btn", true);
  backButton.addEventListener("click", back);
  const root = renderElement("div");
  const chat = mountProjectChat(root, { source: createRemoteProjectChat(end, { onError: (message) => { showToast(message, "error"); } }), projectTitle: project.title });
  return {
    projectId: project.projectId,
    node: renderElement("div", { class: "ds-project-chat" }, renderElement("div", { class: "ds-project-chat-bar" }, backButton), root),
    dispose() {
      chat.dispose();
      end.post({ type: "openProjectChat", spaceId, projectId: null });
    },
  };
}
