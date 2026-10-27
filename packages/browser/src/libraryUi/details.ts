// Wires the page's Details: channel splitting, endpoint merging, the page's capabilities and labels, the mount and the right pane's controls.
import type {
  AllProjectsEndpoint, DetailsSelection, DetailsToHost, HostEndpoint, HostToDetails, LibraryUiCapabilities, LibraryUiLabels, MessageEnd, SpaceStore,
} from "@labshelf/core";
import { mountDetails, mountResearchChat, renderElement, renderIcon } from "@labshelf/core/dom";
import { parseTab, type PageShell } from "./editorArea";
import type { PagePrefs } from "./prefs";

// ---- Page capabilities
export const PAGE_CAPABILITIES: LibraryUiCapabilities = { findPdf: true, attachPdf: true, askAuthor: true, spaces: true };

export const PAGE_LABELS: LibraryUiLabels = {
  addTooltip: "Add a paper from an open tab",
  emptyHint: "Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.",
};

// ---- Endpoint merging
export function mergeEndpoints<Out, In>(a: MessageEnd<Out, In>, b: MessageEnd<Out, In>): MessageEnd<Out, In> {
  return {
    post: (message) => { a.post(message); b.post(message); },
    subscribe: (handler) => {
      const stopA = a.subscribe(handler);
      const stopB = b.subscribe(handler);
      return () => { stopA(); stopB(); };
    },
  };
}

// ---- Channel splitting
export interface DetailsChannelOptions {
  /** The target Details shows when it mounts. */
  current(): DetailsSelection;
  /** Details asked to open a folder in the paper list; the host never sees this message. */
  onFolderOpen(folder: string): void;
}

type Channel = DetailsToHost["channel"];

export function splitDetailsChannels(
  end: MessageEnd<HostToDetails, DetailsToHost>, { current, onFolderOpen }: DetailsChannelOptions,
): { library: HostEndpoint; projects: AllProjectsEndpoint } {
  const handlers: Record<Channel, Set<(msg: never) => void>> = { library: new Set(), projects: new Set() };
  // The host's answer to a channel's ready comes later (and may be asynchronous), so details.show waits for it.
  const awaitingAnswer = new Set<Channel>();
  end.subscribe((m) => {
    if (m.msg.type === "ready") awaitingAnswer.add(m.channel);
    if (m.channel === "library" && m.msg.type === "folder.open") { onFolderOpen(m.msg.folder); return; }
    for (const handler of [...handlers[m.channel]]) handler(m.msg as never);
  });
  const endpoint = <Out, In>(channel: Channel): MessageEnd<Out, In> => ({
    post: (msg) => {
      end.post({ channel, msg } as HostToDetails);
      if (awaitingAnswer.delete(channel)) end.post({ type: "details.show", target: current() });
    },
    subscribe: (handler) => {
      handlers[channel].add(handler as (msg: never) => void);
      return () => { handlers[channel].delete(handler as (msg: never) => void); };
    },
  });
  return { library: endpoint("library"), projects: endpoint("projects") };
}

// ---- Mount
export function mountPageDetails(aside: HTMLElement, transport: MessageEnd<DetailsToHost, HostToDetails>, prefs: PagePrefs): () => void {
  return mountDetails(aside, { transport, prefs, capabilities: PAGE_CAPABILITIES, labels: PAGE_LABELS });
}

// ---- Right pane
export function createRightPane(shell: PageShell, store: Pick<SpaceStore, "list" | "onChange">) {
  const buttons = renderElement("div", { class: "ls-workspace-pane-buttons" });
  const chat = mountResearchChat(shell.chat, { context: null });
  let activeSpace: string | undefined;
  const syncContext = (): void => {
    const result = store.list().find((entry) => entry.state === "ready" && entry.space.id === activeSpace);
    chat.setContext(result?.state === "ready" ? result.space.name : null);
  };
  const unsubscribe = store.onChange(syncContext);
  for (const [pane, label, glyph] of [["details", "Details", "panel-right"], ["chat", "Research chat", "message"]] as const) {
    const button = renderElement("button", {
      class: "ls-icon-btn", type: "button", title: `Toggle ${label}`, "aria-label": `Toggle ${label}`, html: renderIcon(glyph),
    });
    button.dataset["pane"] = pane;
    button.addEventListener("click", () => { shell.togglePane(pane); syncButtons(); });
    buttons.append(button);
  }
  const syncButtons = (): void => {
    for (const button of buttons.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset["pane"] === shell.root.dataset["rightPane"]
        && !shell.root.classList.contains("details-collapsed")));
    }
  };
  // INVARIANT: Sash gestures also change the pane's collapsed state.
  const observer = new MutationObserver(syncButtons);
  observer.observe(shell.root, { attributes: true, attributeFilter: ["class", "data-right-pane"] });
  syncButtons();
  return {
    buttons,
    activateTab(id: string): void {
      const parsed = parseTab(id);
      activeSpace = parsed?.kind === "space" ? parsed.params["id"] : undefined;
      syncContext();
    },
    dispose(): void { observer.disconnect(); unsubscribe(); chat.dispose(); buttons.remove(); },
  };
}
