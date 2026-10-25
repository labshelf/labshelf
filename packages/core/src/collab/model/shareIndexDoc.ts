// Describes the shared project index.

import type { Doc, Map as YMap } from "yjs";
import { watchWrittenVersions } from "./writtenHistory.js";

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
