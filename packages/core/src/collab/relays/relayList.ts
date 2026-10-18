// Reads and edits the relay list of a share's index doc: the relays members offered, in the order clients try them.
import type { Doc } from "yjs";
import { isHttpsUrl } from "../invite/index.js";

/** `addedBy` is the LabShelf user name of the member who offered the relay, the same on each of their devices. */
export interface RelayEntry {
  url: string;
  addedBy: string;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export const indexRelays = (index: Doc) => index.getArray<RelayEntry>("relays");

const isRelayEntry = (value: unknown): value is RelayEntry => {
  const entry = value as Partial<RelayEntry> | null;
  return typeof entry === "object" && entry !== null && typeof entry.addedBy === "string"
    && typeof entry.url === "string" && isHttpsUrl(entry.url);
};

/** The valid entries in list order, each URL once; peers write the index, so their entries are untrusted. */
export function relayList(index: Doc): RelayEntry[] {
  const seen = new Set<string>();
  return indexRelays(index).toArray().flatMap((value) => {
    if (!isRelayEntry(value) || seen.has(value.url)) { return []; }
    seen.add(value.url);
    return [{ url: value.url, addedBy: value.addedBy }];
  });
}

/** Appends a relay; false when the URL is not `https:` or is listed already. */
export function addRelay(index: Doc, entry: RelayEntry): boolean {
  if (!isHttpsUrl(entry.url) || relayList(index).some((listed) => listed.url === entry.url)) { return false; }
  indexRelays(index).push([{ url: entry.url, addedBy: entry.addedBy }]);
  return true;
}

/** Removes the entries of `url` that `memberId` offered; false when there are none. */
export function removeOwnRelay(index: Doc, url: string, memberId: string): boolean {
  const relays = indexRelays(index);
  const own = relays.toArray().flatMap((value, at) => (isRelayEntry(value) && value.url === url && value.addedBy === memberId ? [at] : []));
  if (own.length === 0) { return false; }
  index.transact(() => own.reverse().forEach((at) => relays.delete(at, 1)));
  return true;
}
