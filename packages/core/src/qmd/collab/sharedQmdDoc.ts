// Holds a shared .qmd file in its Yjs doc as one ProseMirror fragment per item, and turns the doc into the file's text and back.
// CONTRACT: documents/contracts/collaboration.md#docs
import { Node } from "prosemirror-model";
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { bodyToDoc, docToBody, qmdSchema } from "../editor/index.js";
import { parseItemFile, type Segment } from "../item/index.js";

const QMD_MAP = "qmd";

/** What an item keeps outside its fragment: the closing line and the body document's attributes, as JSON. */
interface ItemTail { close: string; eol: string; trailing: string; unterminated: boolean }

interface QmdParts {
  order: Y.Array<string>;
  /** The exact fence line of an item, or the text of a loose segment. */
  attrs: Y.Map<string>;
  bodies: Y.Map<Y.XmlFragment>;
  /** An item's ItemTail as JSON. */
  tails: Y.Map<string>;
}

/** The `qmd` map of a shared .qmd doc: `order`, `attrs`, `bodies` and `tails`. */
export function readQmdDoc(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(QMD_MAP);
}

function readParts(doc: Y.Doc, create: boolean): QmdParts | undefined {
  const map = readQmdDoc(doc);
  if (!create && !(map.get("order") instanceof Y.Array)) { return undefined; }
  const heldOrder = map.get("order");
  const order = heldOrder instanceof Y.Array ? (heldOrder as Y.Array<string>) : new Y.Array<string>();
  if (order !== heldOrder) { map.set("order", order); }
  // Reading never writes: a map not synced yet reads as empty.
  function ensureMap<V>(key: string): Y.Map<V> {
    const held = map.get(key);
    if (held instanceof Y.Map) { return held as Y.Map<V>; }
    const made = new Y.Map<V>();
    if (create) { map.set(key, made); }
    return made;
  }
  return { order, attrs: ensureMap<string>("attrs"), bodies: ensureMap<Y.XmlFragment>("bodies"), tails: ensureMap<string>("tails") };
}

function deleteMissing<V>(map: Y.Map<V>, wanted: ReadonlySet<string>): void {
  for (const key of [...map.keys()]) { if (!wanted.has(key)) { map.delete(key); } }
}

function readTail(json: string | undefined): ItemTail {
  try {
    const tail = JSON.parse(json ?? "") as Partial<ItemTail>;
    return { close: tail.close ?? ":::\n", eol: tail.eol ?? "\n", trailing: tail.trailing ?? "", unterminated: tail.unterminated ?? false };
  } catch {
    return { close: ":::\n", eol: "\n", trailing: "", unterminated: false };
  }
}

function readBody(fragment: Y.XmlFragment, tail: ItemTail): string {
  const json = yXmlFragmentToProsemirrorJSON(fragment) as { type: string; content?: unknown[] };
  const node = Node.fromJSON(qmdSchema, { ...json, attrs: { eol: tail.eol, trailing: tail.trailing, unterminated: tail.unterminated } });
  return docToBody(node);
}

/** The file text the doc stands for; a key listed twice (two peers adding the same item) is written once. */
export function readQmdDocText(doc: Y.Doc): string {
  const parts = readParts(doc, false);
  if (!parts) { return ""; }
  const seen = new Set<string>();
  let text = "";
  for (const key of parts.order.toArray()) {
    const head = parts.attrs.get(key);
    if (seen.has(key) || head === undefined) { continue; }
    seen.add(key);
    const fragment = parts.bodies.get(key);
    if (!fragment) { text += head; continue; }
    const tail = readTail(parts.tails.get(key));
    text += head + readBody(fragment, tail) + tail.close;
  }
  return text;
}

interface KeyedSegment { key: string; segment: Segment }

/** Loose segments are `loose-<n>` in file order; an item is its id, made unique when a file repeats it or names a loose key. */
function keySegments(segments: readonly Segment[]): KeyedSegment[] {
  const taken = new Set<string>();
  let loose = 0;
  const keys = segments.map((segment) => {
    if (segment.kind !== "loose") { return undefined; }
    const key = `loose-${loose++}`;
    taken.add(key);
    return key;
  });
  return segments.map((segment, index) => {
    const looseKey = keys[index];
    if (looseKey !== undefined || segment.kind !== "item") { return { key: looseKey ?? "", segment }; }
    let key = segment.id;
    for (let n = 1; taken.has(key); n++) { key = `${segment.id}~${n}`; }
    taken.add(key);
    return { key, segment };
  });
}

function fillFragment(fragment: Y.XmlFragment, body: string): Omit<ItemTail, "close"> {
  const node = bodyToDoc(body);
  prosemirrorJSONToYXmlFragment(qmdSchema, node.toJSON(), fragment);
  const { eol, trailing, unterminated } = node.attrs as { eol: string; trailing: string; unterminated: boolean };
  return { eol, trailing, unterminated };
}

/** Changes the order so it lists `next`: removes what left, inserts what came, and rewrites it whole only on a reorder. */
function updateOrder(order: Y.Array<string>, next: readonly string[]): void {
  const wanted = new Set(next);
  const current = order.toArray();
  const kept = new Set<string>();
  for (let index = current.length - 1; index >= 0; index--) {
    const key = current[index]!;
    // A later copy of a key is the duplicate; scanning back keeps the first.
    if (!wanted.has(key) || current.indexOf(key) !== index) { order.delete(index, 1); } else { kept.add(key); }
  }
  const remaining = order.toArray();
  const expected = next.filter((key) => kept.has(key));
  if (remaining.length !== expected.length || remaining.some((key, index) => key !== expected[index])) {
    order.delete(0, order.length);
    order.insert(0, [...next]);
    return;
  }
  next.forEach((key, index) => { if (order.get(index) !== key) { order.insert(index, [key]); } });
}

/**
 * Makes the doc stand for `text` with an item-level diff in one transaction under `origin`: added, removed and moved
 * segments change the order, a changed fence line or loose text is set, and only a changed body gets a new fragment.
 */
export function setQmdDocText(doc: Y.Doc, text: string, origin: unknown): void {
  if (readQmdDocText(doc) === text) { return; }
  const keyed = keySegments(parseItemFile(text).segments);
  doc.transact(() => {
    const parts = readParts(doc, true)!;
    const wanted = new Set(keyed.map(({ key }) => key));
    deleteMissing(parts.attrs, wanted);
    deleteMissing(parts.bodies, wanted);
    deleteMissing(parts.tails, wanted);
    for (const { key, segment } of keyed) {
      if (segment.kind === "loose") {
        if (parts.attrs.get(key) !== segment.text) { parts.attrs.set(key, segment.text); }
        if (parts.bodies.has(key)) { parts.bodies.delete(key); }
        if (parts.tails.has(key)) { parts.tails.delete(key); }
        continue;
      }
      if (parts.attrs.get(key) !== segment.fence) { parts.attrs.set(key, segment.fence); }
      const held = parts.bodies.get(key);
      const heldTail = readTail(parts.tails.get(key));
      let tail: ItemTail = { ...heldTail, close: segment.close };
      if (!held || readBody(held, heldTail) !== segment.body) {
        const fragment = new Y.XmlFragment();
        parts.bodies.set(key, fragment);
        tail = { ...fillFragment(fragment, segment.body), close: segment.close };
      }
      const json = JSON.stringify(tail);
      if (parts.tails.get(key) !== json) { parts.tails.set(key, json); }
    }
    updateOrder(parts.order, keyed.map(({ key }) => key));
  }, origin);
}
