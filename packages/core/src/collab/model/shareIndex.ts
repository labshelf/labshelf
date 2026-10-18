/** Reads and initialises the index doc of a share: its kind, its file entries, its shared settings and its comment threads. */

// PLATFORM: yjs ships ESM types, so this CommonJS package imports them with an explicit resolution mode.
import type { Doc, Map as YMap } from "yjs";

export const SHARE_KINDS = ["project"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** One file of a share: a text file has its own doc keyed by its path, a blob is fetched by its sha256 hex. */
export interface ShareFileEntry {
  kind: "text" | "blob";
  hash?: string;
}

export type IndexKindResult =
  | { ok: true; kind: ShareKind }
  | { ok: false; error: "unknownShareKind"; kind: unknown }
  | { ok: false; error: "missingShareKind" };

const shareMap = (doc: Doc): YMap<unknown> => doc.getMap("share");

/** Marks a fresh index doc as the index of a project. */
export function createProjectIndex(doc: Doc): void {
  shareMap(doc).set("kind", "project");
}

/** The kind of share the index belongs to; a kind from a later version is an error the caller shows, not a project. */
export function readIndexKind(doc: Doc): IndexKindResult {
  const kind = shareMap(doc).get("kind");
  if (kind === undefined) { return { ok: false, error: "missingShareKind" }; }
  return (SHARE_KINDS as readonly unknown[]).includes(kind)
    ? { ok: true, kind: kind as ShareKind }
    : { ok: false, error: "unknownShareKind", kind };
}

/** POSIX relative path to its entry; renames and deletes are edits of this map. */
export const indexFiles = (doc: Doc): YMap<ShareFileEntry> => doc.getMap("files");

/** The shared labshelf.yaml keys as plain JSON values. */
export const indexSettings = (doc: Doc): YMap<unknown> => doc.getMap("settings");

/** Comment threads by thread id. */
export const indexComments = (doc: Doc): YMap<unknown> => doc.getMap("comments");
