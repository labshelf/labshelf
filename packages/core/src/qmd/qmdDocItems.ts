// Lists the items of a shared .qmd doc (key, id, fence line, fragment) in order and tells when that list changes.
// CONTRACT: documents/contracts/collaboration.md#docs
import * as Y from "yjs";
import { parseItemFile, type ItemSegment } from "./item/index.js";
import { readQmdDoc } from "./sharedQmdDoc.js";

/** One item of the doc: `key` is its doc key (the id, or `id~n` for a repeated id), `fence` its exact fence line. */
export interface QmdDocItem { key: string; id: string; fence: string; fragment: Y.XmlFragment }

/** The item a fence line opens (id, author, created), or undefined when the line opens no item. */
export function parseQmdFence(fence: string): ItemSegment | undefined {
  const line = /[\r\n]$/.test(fence) ? fence : `${fence}\n`;
  const segment = parseItemFile(`${line}:::\n`).segments[0];
  return segment?.kind === "item" ? segment : undefined;
}

/** The items in doc order: the first copy of each key, without loose segments or keys missing a fence line or a fragment. */
export function listQmdItems(doc: Y.Doc): QmdDocItem[] {
  const map = readQmdDoc(doc);
  const order = map.get("order");
  const attrs = map.get("attrs");
  const bodies = map.get("bodies");
  if (!(order instanceof Y.Array) || !(attrs instanceof Y.Map) || !(bodies instanceof Y.Map)) { return []; }
  const seen = new Set<string>();
  const items: QmdDocItem[] = [];
  for (const key of order.toArray() as string[]) {
    if (seen.has(key)) { continue; }
    seen.add(key);
    const fence: unknown = attrs.get(key);
    const fragment: unknown = bodies.get(key);
    if (typeof fence !== "string" || !(fragment instanceof Y.XmlFragment)) { continue; }
    const segment = parseQmdFence(fence);
    if (!segment) { continue; }
    items.push({ key, id: segment.id, fence, fragment });
  }
  return items;
}

/** Calls `listener` after a transaction that adds, removes, moves or re-fences an item or swaps its fragment; edits inside a fragment do not count. Returns the unsubscribe. */
export function observeQmdItems(doc: Y.Doc, listener: () => void): () => void {
  const map = readQmdDoc(doc);
  const changesItems = (event: Y.YEvent<Y.AbstractType<unknown>>): boolean => {
    const { target } = event;
    return target === map || target === map.get("order") || target === map.get("attrs") || target === map.get("bodies");
  };
  const observer = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => { if (events.some(changesItems)) { listener(); } };
  map.observeDeep(observer);
  return () => { map.unobserveDeep(observer); };
}
