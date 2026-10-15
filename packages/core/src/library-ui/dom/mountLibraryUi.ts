/**
 * Mounts the library UI once into a host element (frame, header, filter bar, list, detail pane) wired to a host
 * through a transport. The host fills the optional sidebar slot with its own folder view.
 */
import type { LibraryUiCapabilities, LibraryUiLabels } from "../hostConfig.js";
import type { LibraryTransport } from "../protocol/index.js";
import { LibraryViewStore, type PrefsPort } from "../state/index.js";
import { mountDetailPane } from "./detail/index.js";
import { makeDropTarget } from "./dnd/index.js";
import { mountFilterBar } from "./filterBar/index.js";
import { confirmDeleteFolder, promptNewFolder, promptRenameFolder } from "./flows/index.js";
import { mountListHeader } from "./header/index.js";
import { attachHostMessages } from "./hostMessages.js";
import { mountPaperList } from "./list/index.js";
import { buildFrame } from "./shell/index.js";
import { createUiContext, type UiContext } from "./uiContext.js";

export interface LibraryUiOptions {
  transport: LibraryTransport;
  prefs: PrefsPort;
  /** What the host can do beyond the shared actions; see the library UI host contract. */
  capabilities: LibraryUiCapabilities;
  labels: LibraryUiLabels;
  /** Adds a resizable sidebar slot left of the list. */
  withSidebar?: boolean;
}

/** What a host's own glue (such as a sidebar folder tree) can use. */
export interface LibraryUi {
  /** The sidebar slot, when one was asked for. */
  sidebar: HTMLElement | null;
  store: LibraryViewStore;
  /** The folder prompts, so host glue offers the same New, Rename and Delete. */
  folders: { create(parent: string): void; rename(path: string): void; remove(path: string): void };
  /** Makes `el` accept dropped papers and move them into `folder`. */
  dropTarget(el: HTMLElement, folder: string): void;
  dispose(): void;
}

// Tells the host about every folder change after the first render; the host answers navigation of its own with `navigate`.
function reportFolder(ctx: UiContext): () => void {
  let first = true;
  return ctx.store.select((s) => s.folder, (folder) => {
    if (first) { first = false; return; }
    ctx.transport.post({ type: "navigate", folder });
  });
}

export function mountLibraryUi(host: HTMLElement, options: LibraryUiOptions): LibraryUi {
  const saved = options.prefs.load();
  const store = new LibraryViewStore({ sortKey: saved.sortKey, sortDir: saved.sortDir, includeSub: saved.includeSub });
  const { transport, prefs, capabilities: caps, labels } = options;
  // Without reading stats the Last read column has nothing to say, so it is not drawn.
  const frame = buildFrame(host, prefs, options.withSidebar ?? false, caps.paperData ? [] : ["no-reading"]);
  const ctx = createUiContext(frame.root, { store, transport, prefs, caps, labels });
  const offs = [
    attachHostMessages(ctx),
    mountListHeader(ctx, frame.header),
    mountFilterBar(ctx, frame.filterBar),
    mountPaperList(ctx, frame.list),
    mountDetailPane(ctx, frame.detail),
    reportFolder(ctx),
  ];
  options.transport.post({ type: "ready" });
  return {
    sidebar: frame.sidebar,
    store,
    folders: {
      create: (parent) => { void promptNewFolder(ctx, parent); },
      rename: (path) => { void promptRenameFolder(ctx, path); },
      remove: (path) => { void confirmDeleteFolder(ctx, path); },
    },
    dropTarget: (el, folder) => makeDropTarget(ctx, el, folder),
    dispose: () => { offs.forEach((off) => off()); frame.dispose(); frame.root.remove(); },
  };
}
