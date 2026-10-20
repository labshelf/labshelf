/**
 * Mounts the library UI once into a host element (frame, header, list, citation map) wired to a host
 * through a transport. The host fills the optional sidebar slot with its own folder view.
 */
import type { LibraryUiCapabilities, LibraryUiLabels } from "../hostConfig.js";
import type { LibraryTransport } from "../protocol/index.js";
import type { SharingHost } from "../sharing/index.js";
import { LibraryViewStore, type PrefsPort } from "../state/index.js";
import { mountCitationMap } from "./citationMap/index.js";
import { makeDropTarget } from "./dnd/index.js";
import { confirmDeleteFolder, promptNewFolder, promptRenameFolder } from "./flows/index.js";
import { mountListHeader } from "./header/index.js";
import { attachHostMessages } from "./hostMessages.js";
import { mountPaperList } from "./list/index.js";
import { reportSelection } from "./reportSelection.js";
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
  /** Shows the library for reading only: no Add button, tag editing or note editor; search stays. */
  readOnly?: boolean;
  /** Shows the sharing controls the host offers; absent or read-only shows none. */
  sharing?: SharingHost;
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
  const store = new LibraryViewStore({ sortKey: saved.sortKey, sortDir: saved.sortDir, columns: saved.columns });
  const { transport, prefs, capabilities: caps, labels } = options;
  const frame = buildFrame(host, prefs, { withSidebar: options.withSidebar ?? false, withCitationMap: true });
  const ctx = createUiContext(frame.root, { store, transport, prefs, caps, labels, readOnly: options.readOnly ?? false, sharing: options.sharing });
  const offs = [
    attachHostMessages(ctx),
    mountListHeader(ctx, frame.header),
    mountPaperList(ctx, frame.list),
    mountCitationMap(ctx, frame.citationMap!),
    reportFolder(ctx),
    reportSelection(ctx),
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
    dispose: () => { offs.forEach((off) => off()); frame.root.remove(); },
  };
}
