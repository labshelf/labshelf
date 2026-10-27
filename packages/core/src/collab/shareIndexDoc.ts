// Describes the shared project index and retains the written-version history across concurrent index updates.
import { Array as YArray, type Doc, type Map as YMap } from "yjs";

export const SHARE_KINDS = ["project"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** One file of a share: a text file has its own doc keyed by its path, a blob is fetched by its sha256 hex. */
export interface ShareFileEntry {
  kind: "text" | "blob";
  hash?: string;
}

export type ShareIndexDocKindResult =
  | { ok: true; kind: ShareKind }
  | { ok: false; error: "unknownShareKind"; kind: unknown }
  | { ok: false; error: "missingShareKind" };

const shareMap = (doc: Doc): YMap<unknown> => doc.getMap("share");

export function createShareIndexDoc(doc: Doc): void {
  watchWrittenVersions(doc);
  shareMap(doc).set("kind", "project");
}

/** The kind of share the index belongs to; a kind from a later version is an error the caller shows, not a project. */
export function readShareIndexDocKind(doc: Doc): ShareIndexDocKindResult {
  const kind = shareMap(doc).get("kind");
  if (kind === undefined) { return { ok: false, error: "missingShareKind" }; }
  return (SHARE_KINDS as readonly unknown[]).includes(kind)
    ? { ok: true, kind: kind as ShareKind }
    : { ok: false, error: "unknownShareKind", kind };
}

export function readShareIndexDocFiles(doc: Doc): YMap<ShareFileEntry> {
  watchWrittenVersions(doc);
  return doc.getMap("files");
}

export const readShareIndexDocSettings = (doc: Doc): YMap<unknown> => doc.getMap("settings");

export const readShareIndexDocComments = (doc: Doc): YMap<unknown> => doc.getMap("comments");

export const WRITTEN_PER_PATH = 200;
export interface WrittenVersion { hash: string; at: number }
interface ObservedVersions { array: YArray<WrittenVersion>; entries: WrittenVersion[] }
const observed = new WeakSet<Doc>();

function repairPath(doc: Doc, path: string, remembered: Map<string, ObservedVersions>): void {
  const written = doc.getMap<YArray<WrittenVersion>>("written");
  const array = written.get(path);
  if (!array || !doc.getMap("files").has(path)) {
    remembered.delete(path);
    if (array) { written.delete(path); }
    return;
  }
  const previous = remembered.get(path);
  const entries = array.toArray();
  // Y.Map arbitrates concurrent nested arrays; the losing author republishes its bounded history.
  const missing = previous && previous.array !== array
    ? previous.entries.filter((entry) => !entries.some((item) => item.hash === entry.hash && item.at === entry.at))
    : [];
  remembered.set(path, { array, entries: [...entries, ...missing].slice(-WRITTEN_PER_PATH) });
  if (missing.length > 0) { array.push(missing); }
  if (array.length > WRITTEN_PER_PATH) { array.delete(0, array.length - WRITTEN_PER_PATH); }
}

function watchWrittenVersions(doc: Doc): void {
  if (observed.has(doc)) { return; }
  observed.add(doc);
  const written = doc.getMap<YArray<WrittenVersion>>("written");
  const remembered = new Map<string, ObservedVersions>();
  for (const [path, array] of written) {
    remembered.set(path, { array, entries: array.toArray().slice(-WRITTEN_PER_PATH) });
  }
  written.observeDeep((events) => {
    const paths = new Set<string>();
    for (const event of events) {
      if (event.target === written) {
        for (const path of (event as import("yjs").YMapEvent<YArray<WrittenVersion>>).keysChanged) { paths.add(path); }
      } else if (typeof event.path[0] === "string") { paths.add(event.path[0]); }
    }
    doc.transact(() => { for (const path of paths) { repairPath(doc, path, remembered); } });
  });
  doc.getMap("files").observe((event) => {
    for (const path of event.keysChanged) {
      if (!doc.getMap("files").has(path)) { remembered.delete(path); written.delete(path); }
    }
  });
}

export function readWrittenVersions(doc: Doc): YMap<YArray<WrittenVersion>> {
  watchWrittenVersions(doc);
  return doc.getMap("written");
}

export function addWrittenVersion(doc: Doc, path: string, hash: string, at: number): void {
  const written = readWrittenVersions(doc);
  if (!doc.getMap("files").has(path)) { return; }
  doc.transact(() => {
    let versions = written.get(path);
    if (!versions) { versions = new YArray<WrittenVersion>(); written.set(path, versions); }
    if (versions.get(versions.length - 1)?.hash === hash) { return; }
    versions.push([{ hash, at }]);
    if (versions.length > WRITTEN_PER_PATH) { versions.delete(0, versions.length - WRITTEN_PER_PATH); }
  });
}

export function readWrittenHashes(doc: Doc, path: string): ReadonlySet<string> {
  return new Set(readWrittenVersions(doc).get(path)?.toArray().map((entry) => entry.hash) ?? []);
}
