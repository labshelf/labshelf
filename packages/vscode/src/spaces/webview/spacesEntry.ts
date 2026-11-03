// Mounts the Spaces catalog or Space page over the VS Code messaging transport.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-tabs.css";
import "@labshelf/core/styles/place-header.css";
import "@labshelf/core/styles/spaces-catalog.css";
import "@labshelf/core/styles/spaces.css";
import "@labshelf/core/styles/spaces-overview.css";
import { SPACE_TABS, type HostToSpaces, type SpacesToHost, type SpaceTab } from "@labshelf/core";
import { findElement, mountSpace, mountSpacesCatalog } from "@labshelf/core/dom";
import { createWebviewNoteViewStore, createWebviewTransport } from "../../webview/index.js";

const api = acquireVsCodeApi();
const config = JSON.parse(findElement("spaces-config").textContent ?? "{}") as { view: string; id?: string; tab?: SpaceTab };
const viewState = createWebviewNoteViewStore(api);
const end = createWebviewTransport<SpacesToHost, HostToSpaces>(api);
if (config.view === "space" && config.id) {
  const id = config.id;
  const saved = api.getState() as { tab?: unknown } | undefined;
  const initial = SPACE_TABS.includes(saved?.tab as SpaceTab) ? saved?.tab as SpaceTab : config.tab ?? "overview";
  // The state also holds the notes' view state, so the tab is merged into it.
  const saveTab = (tab: SpaceTab): void => {
    const current = api.getState();
    api.setState({ ...(current && typeof current === "object" ? current : {}), tab });
  };
  let dispose = mount(initial);
  function mount(tab: SpaceTab): () => void {
    saveTab(tab);
    return mountSpace(findElement("root"), end, { id, tab, viewState, onTab: saveTab });
  }
  window.addEventListener("message", event => {
    const message = event.data as { type?: unknown; tab?: unknown } | null;
    if (message?.type !== "spaces.navigate" || !SPACE_TABS.includes(message.tab as SpaceTab)) return;
    dispose(); dispose = mount(message.tab as SpaceTab);
  });
} else mountSpacesCatalog(findElement("root"), end);
