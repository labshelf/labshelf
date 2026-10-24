// Describes the shared project index.

import type { Doc, Map as YMap } from "yjs";
import { observeWritten } from "./writtenHistory.js";

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

export function createProjectIndex(doc: Doc): void {
  observeWritten(doc);
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

export function indexFiles(doc: Doc): YMap<ShareFileEntry> {
  observeWritten(doc);
  return doc.getMap("files");
}

export const indexSettings = (doc: Doc): YMap<unknown> => doc.getMap("settings");

export const indexComments = (doc: Doc): YMap<unknown> => doc.getMap("comments");
