// Shows the papers the Details surface targets in the library detail pane, fed by the library channel alone.
import type { LibraryUiCapabilities, LibraryUiLabels } from "../../library-ui/index.js";
import { attachHostMessages, createUiContext, mountDetailPane } from "../../library-ui/dom/index.js";
import type { HostToUi, LibraryTransport, MessageEnd, UiToHost } from "../../library-ui/protocol/index.js";
import { LibraryViewStore, type PrefsPort } from "../../library-ui/state/index.js";
import type { DetailsToHost, HostToDetails } from "../protocol/index.js";

export interface PaperSlotParts {
  transport: MessageEnd<DetailsToHost, HostToDetails>;
  prefs: PrefsPort;
  caps: LibraryUiCapabilities;
  labels: LibraryUiLabels;
}

export interface PaperSlot {
  /** Shows these papers; ids the library does not hold are ignored. */
  show(ids: readonly string[]): void;
  /** True while at least one paper is shown. */
  hasContent(): boolean;
  /** Calls `listener` now and whenever `hasContent` may have changed; returns the way to stop. */
  watch(listener: () => void): () => void;
  dispose(): void;
}

// The list owns the folder, the search, the selection it reports and the citation map; Details keeps the papers it was shown.
const LIST_ONLY = new Set<HostToUi["type"]>(["navigate", "searchTag", "reveal", "select", "citationMap.show", "citationMap.imported", "citationMap.importFailed"]);

/** Opening a folder belongs to the paper list, so Details asks the host to forward it there. */
class DetailsViewStore extends LibraryViewStore {
  private readonly post: (message: UiToHost) => void;
  constructor(post: (message: UiToHost) => void) { super(); this.post = post; }
  // CONTRACT: documents/contracts/details-host.md#envelope
  override openFolder(folder: string): void { this.post({ type: "folder.open", folder }); }
}

function libraryChannel(transport: PaperSlotParts["transport"]): LibraryTransport {
  return {
    post: (msg) => transport.post({ channel: "library", msg }),
    subscribe: (handler) => transport.subscribe((m) => {
      if ("channel" in m && m.channel === "library" && !LIST_ONLY.has(m.msg.type)) handler(m.msg);
    }),
  };
}

/** `root` is the surface's root element; `el` is the slot the pane renders into. */
export function mountPaperSlot(root: HTMLElement, el: HTMLElement, parts: PaperSlotParts): PaperSlot {
  const transport = libraryChannel(parts.transport);
  const store = new DetailsViewStore(transport.post);
  const base = createUiContext(root, { store, transport, prefs: parts.prefs, caps: parts.caps, labels: parts.labels, readOnly: false });
  // Keys belong to the list, which lives elsewhere.
  const ctx = { ...base, focusList: () => undefined };
  let wanted: readonly string[] = [];
  const held = (ids: readonly string[]): string[] => {
    const known = new Set(store.get().papers.map((p) => p.id));
    return ids.filter((id) => known.has(id));
  };
  // A target can arrive before the snapshot holding its papers, and a snapshot can drop a shown paper.
  const offPapers = store.select((s) => s.papers, () => {
    const selected = [...store.get().selected];
    const kept = held(selected);
    const next = kept.length > 0 ? kept : held(wanted);
    if (kept.length !== selected.length || (kept.length === 0 && next.length > 0)) store.set({ selected: new Set(next) });
  });
  const offs = [attachHostMessages(ctx), mountDetailPane(ctx, el), offPapers];
  return {
    show(ids) { wanted = ids; store.set({ selected: new Set(held(ids)) }); },
    hasContent: () => store.get().selected.size > 0,
    watch: (listener) => store.select((s) => s.selected.size > 0, () => listener()),
    dispose: () => offs.forEach((off) => off()),
  };
}
