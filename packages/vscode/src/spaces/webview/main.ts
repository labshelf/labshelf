// Mounts the Spaces catalog or Space page over the VS Code messaging transport.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "@labshelf/core/styles/toast.css";
import "@labshelf/core/styles/library-ui.css";
import "@labshelf/core/styles/library-tabs.css";
import "@labshelf/core/styles/spaces-catalog.css";
import "@labshelf/core/styles/spaces.css";
import "@labshelf/core/styles/spaces-overview.css";
import { SPACE_TABS, type HostToSpaces, type SpacesToHost, type SpaceTab } from "@labshelf/core";
import { $, mountSpace, mountSpacesCatalog } from "@labshelf/core/dom";
import { webviewTransport } from "../../webviewMessaging/index.js";

const api = acquireVsCodeApi();
const config = JSON.parse($("spaces-config").textContent ?? "{}") as { view: string; id?: string; tab?: SpaceTab };
const end = webviewTransport<SpacesToHost, HostToSpaces>(api);
if (config.view === "space" && config.id) {
  const id = config.id;
  const saved = api.getState() as { tab?: unknown } | undefined;
  const initial = SPACE_TABS.includes(saved?.tab as SpaceTab) ? saved?.tab as SpaceTab : config.tab ?? "overview";
  let dispose = mount(initial);
  function mount(tab: SpaceTab): () => void {
    api.setState({ tab });
    return mountSpace($("root"), end, { id, tab, onTab: tab => api.setState({ tab }) });
  }
  window.addEventListener("message", event => {
    const message = event.data as { type?: unknown; tab?: unknown } | null;
    if (message?.type !== "spaces.navigate" || !SPACE_TABS.includes(message.tab as SpaceTab)) return;
    dispose(); dispose = mount(message.tab as SpaceTab);
  });
} else mountSpacesCatalog($("root"), end);
