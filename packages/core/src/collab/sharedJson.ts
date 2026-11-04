// Holds the shared part of a JSON file in a share's index: top-level values, and arrays of id-keyed entries merged entry by entry.
// CONTRACT: documents/contracts/collaboration.md#space-shares
import type { Array as YArray, Doc, Map as YMap } from "yjs";
import { isRecord } from "../guards/index.js";

/** Which keys of a JSON file a share holds; every other key, and each collection's `localFields`, stays per user. */
export interface SharedJsonSpec {
  /** Names the index types: `<prefix>` holds the values, `<prefix>.<key>` and `<prefix>.<key>.order` a collection. */
  readonly prefix: string;
  readonly values: readonly string[];
  readonly collections: readonly { readonly key: string; readonly localFields?: readonly string[] }[];
}

type JsonObject = Record<string, unknown>;

export interface SharedJsonCollection {
  readonly order: readonly string[];
  readonly entries: Readonly<Record<string, JsonObject>>;
}

/** The shared part of a file as plain JSON; an absent value is a key the file does not hold. */
export interface SharedJson {
  readonly values: Readonly<Record<string, unknown>>;
  readonly collections: Readonly<Record<string, SharedJsonCollection>>;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const entryId = (entry: unknown): string | undefined =>
  isRecord(entry) && typeof entry["id"] === "string" && entry["id"] !== "" ? entry["id"] : undefined;

function withoutFields(entry: JsonObject, fields: readonly string[]): JsonObject {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !fields.includes(key)));
}

/**
 * The shared part of a parsed file. An entry without a text id stays with this user's file, as does a repeated id after its
 * first entry, so a share never holds what the file's reader would drop.
 */
export function readSharedJson(raw: JsonObject, spec: SharedJsonSpec): SharedJson {
  const values = Object.fromEntries(spec.values.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
  const collections: Record<string, SharedJsonCollection> = {};
  for (const { key, localFields = [] } of spec.collections) {
    // TRAP: ids are untrusted, and assigning "__proto__" would set the prototype, so entries go through a Map.
    const entries = new Map<string, JsonObject>();
    for (const entry of Array.isArray(raw[key]) ? raw[key] as unknown[] : []) {
      const id = entryId(entry);
      if (id !== undefined && !entries.has(id)) { entries.set(id, withoutFields(entry as JsonObject, localFields)); }
    }
    collections[key] = { order: [...entries.keys()], entries: Object.fromEntries(entries) };
  }
  return { values, collections };
}

const valuesMap = (doc: Doc, spec: SharedJsonSpec): YMap<unknown> => doc.getMap(spec.prefix);
const entriesMap = (doc: Doc, spec: SharedJsonSpec, key: string): YMap<JsonObject> => doc.getMap(`${spec.prefix}.${key}`);
// INVARIANT: root types only, since two members creating the same nested type at once would leave one's entries out.
const orderArray = (doc: Doc, spec: SharedJsonSpec, key: string): YArray<string> => doc.getArray(`${spec.prefix}.${key}.order`);

/** True once a member put the file into the share. */
export const hasSharedJson = (doc: Doc, spec: SharedJsonSpec): boolean => valuesMap(doc, spec).size > 0
  || spec.collections.some(({ key }) => entriesMap(doc, spec, key).size > 0);

/** The shared part the index holds; entries missing from the order follow the ordered ones, and an order id without an entry is skipped. */
export function readSharedJsonDoc(doc: Doc, spec: SharedJsonSpec): SharedJson {
  const values = valuesMap(doc, spec);
  const collections: Record<string, SharedJsonCollection> = {};
  for (const { key } of spec.collections) {
    const map = entriesMap(doc, spec, key);
    const order = [...new Set(orderArray(doc, spec, key).toArray())].filter((id) => map.has(id));
    const unordered = [...map.keys()].filter((id) => !order.includes(id)).sort();
    collections[key] = { order: [...order, ...unordered], entries: Object.fromEntries(map.entries()) };
  }
  return { values: Object.fromEntries(spec.values.filter((key) => values.has(key)).map((key) => [key, values.get(key)])), collections };
}

const EMPTY: SharedJson = { values: {}, collections: {} };

/**
 * Writes only what differs from `base`, the part the index and the file agree on, so a value or entry another member set is
 * kept; without a base the file's values and entries are added and nothing is removed. A new entry goes after the entry before
 * it in the file.
 */
export function writeSharedJsonDoc(doc: Doc, spec: SharedJsonSpec, next: SharedJson, base: SharedJson | undefined, origin: unknown): void {
  const from = base ?? EMPTY;
  doc.transact(() => {
    const values = valuesMap(doc, spec);
    for (const key of spec.values) {
      const value = next.values[key];
      if (base && same(value, from.values[key])) { continue; }
      // Without a base nothing is known to be removed, so an absent value is left as the share holds it.
      if (value === undefined) { if (base && values.has(key)) { values.delete(key); } } else if (!same(values.get(key), value)) { values.set(key, value); }
    }
    for (const { key } of spec.collections) {
      const wanted = next.collections[key] ?? { order: [], entries: {} };
      const before = from.collections[key] ?? { order: [], entries: {} };
      const map = entriesMap(doc, spec, key);
      const order = orderArray(doc, spec, key);
      const removed = base ? before.order.filter((id) => wanted.entries[id] === undefined) : [];
      for (const id of removed) { map.delete(id); }
      removeFromOrder(order, new Set(removed));
      wanted.order.forEach((id, position) => {
        const entry = wanted.entries[id]!;
        if (base && same(entry, before.entries[id])) { return; }
        if (!same(map.get(id), entry)) { map.set(id, entry); }
        if (!order.toArray().includes(id)) { insertAfter(order, id, wanted.order.slice(0, position)); }
      });
    }
  }, origin);
}

function removeFromOrder(order: YArray<string>, ids: ReadonlySet<string>): void {
  for (let index = order.length - 1; index >= 0; index -= 1) {
    if (ids.has(order.get(index))) { order.delete(index, 1); }
  }
}

function insertAfter(order: YArray<string>, id: string, preceding: readonly string[]): void {
  const current = order.toArray();
  for (let index = preceding.length - 1; index >= 0; index -= 1) {
    const at = current.lastIndexOf(preceding[index]!);
    if (at >= 0) { order.insert(at + 1, [id]); return; }
  }
  order.insert(0, [id]);
}

/**
 * The file with the shared part replaced: its own keys keep their place, each shared entry keeps this user's `localFields` of
 * the entry with its id, and the entries the share does not hold (no id) stay after the shared ones.
 */
export function applySharedJson(raw: JsonObject, shared: SharedJson, spec: SharedJsonSpec): JsonObject {
  const result: JsonObject = { ...raw };
  for (const key of spec.values) {
    if (shared.values[key] === undefined) { delete result[key]; } else { result[key] = shared.values[key]; }
  }
  for (const { key, localFields = [] } of spec.collections) {
    const local = Array.isArray(raw[key]) ? raw[key] as unknown[] : [];
    const localById = new Map(local.flatMap((entry) => { const id = entryId(entry); return id === undefined ? [] : [[id, entry as JsonObject] as const]; }));
    const collection = shared.collections[key] ?? { order: [], entries: {} };
    const entries = collection.order.filter((id) => Object.hasOwn(collection.entries, id)).map((id) => {
      const mine = localById.get(id);
      const kept = mine ? Object.fromEntries(localFields.filter((field) => mine[field] !== undefined).map((field) => [field, mine[field]])) : {};
      return { ...collection.entries[id], ...kept };
    });
    result[key] = [...entries, ...local.filter((entry) => entryId(entry) === undefined)];
  }
  return result;
}

export const isSameSharedJson = (a: SharedJson, b: SharedJson): boolean => same(a, b);
