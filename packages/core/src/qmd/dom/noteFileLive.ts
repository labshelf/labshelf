// Follows the items of a live qmd doc for a notes file mount: mounts the editor of a new key, destroys the editor of a removed key, remounts a key whose fragment changed and keeps the rest.
import type * as Y from "yjs";
import type { ItemSegment } from "../item/index.js";
import { listQmdItems, observeQmdItems, parseQmdFence, type QmdDocItem } from "../qmdDocItems.js";
import { readQmdItemBody } from "../sharedQmdDoc.js";

/** A doc item as the notes file mount shows it: id, author and created from the fence, and the body read from the fragment whenever asked. */
export function toLiveItem(doc: Y.Doc, item: QmdDocItem): Pick<ItemSegment, "id" | "body" | "author" | "created"> {
  const segment = parseQmdFence(item.fence);
  return {
    id: item.id,
    ...(segment?.author === undefined ? {} : { author: segment.author }),
    ...(segment?.created === undefined ? {} : { created: segment.created }),
    get body() { return readQmdItemBody(doc, item.key) ?? ""; },
  };
}

/** Makes `list` hold exactly `cards`, in that order, moving a card only when the order differs. */
export function placeLiveCards(list: HTMLElement, cards: readonly HTMLElement[]): void {
  const wanted = new Set<Element>(cards);
  for (const child of [...list.children]) { if (!wanted.has(child)) child.remove(); }
  if (cards.some((card, index) => list.children[index] !== card)) list.append(...cards);
}

/** What the follower asks of the mount: build one item's view, tear one down, and show the views in doc order. */
export interface LiveItemsHost<M> {
  mount(item: QmdDocItem): M;
  destroy(mounted: M): void;
  /** Called after every sync with the mounted views in doc order (empty when the doc has no item). */
  show(mounted: readonly M[], items: readonly QmdDocItem[]): void;
}

export interface LiveItems<M> {
  /** The mounted views in doc order. */
  readonly mounted: readonly M[];
  /** Destroys every mounted view and stops following the doc. */
  destroy(): void;
}

interface Entry<M> { fragment: Y.XmlFragment; mounted: M }

/** Mounts the doc's items now and follows their changes until destroyed. */
export function followLiveItems<M>(doc: Y.Doc, host: LiveItemsHost<M>): LiveItems<M> {
  const entries = new Map<string, Entry<M>>();
  let mounted: M[] = [];
  const sync = (): void => {
    const items = listQmdItems(doc);
    const wanted = new Map(items.map((item) => [item.key, item]));
    for (const [key, entry] of [...entries]) {
      if (wanted.get(key)?.fragment === entry.fragment) { continue; }
      entries.delete(key);
      host.destroy(entry.mounted);
    }
    mounted = items.map((item) => {
      let entry = entries.get(item.key);
      if (!entry) {
        entry = { fragment: item.fragment, mounted: host.mount(item) };
        entries.set(item.key, entry);
      }
      return entry.mounted;
    });
    host.show(mounted, items);
  };
  sync();
  const stop = observeQmdItems(doc, sync);
  return {
    get mounted() { return mounted; },
    destroy() {
      stop();
      for (const entry of entries.values()) { host.destroy(entry.mounted); }
      entries.clear();
      mounted = [];
    },
  };
}
