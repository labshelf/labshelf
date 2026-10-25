/** Declares the ports a template catalog is read through: a source of entries and files, and the device cache of fetched indexes. */
// CONTRACT: documents/contracts/templates.md#cache

import type { TemplateEntry, TemplateSourceId } from "../templateEntry.js";

/** One file of a template, with its path relative to the template's files/ folder. */
export interface TemplateFile {
  path: string;
  bytes: Uint8Array;
}

/** The entries a source offers, and whether they come from the device's cached index because the fetch failed. */
export interface TemplateListing {
  entries: TemplateEntry[];
  fromCache: boolean;
}

/** A place the gallery lists templates from and downloads their files from. */
export interface TemplateSource {
  readonly id: TemplateSourceId;
  /** The entries this source offers; throws only when there is neither a fresh nor a cached list. */
  list(signal?: AbortSignal): Promise<TemplateListing>;
  /** The entry's card image, or undefined when it has none or cannot be fetched (logged, never thrown). */
  thumbnail(entry: TemplateEntry, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  /** Every file of the entry, checked against the path rules; throws with a user-facing message on any refusal. */
  files(entry: TemplateEntry, signal?: AbortSignal): Promise<TemplateFile[]>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

export type CachedSourceId = Exclude<TemplateSourceId, "mine">;

/** The last index a remote source received, as stored on this device. */
export interface CachedCatalogIndex {
  body: string;
  etag?: string;
}

/** Reads and writes the per-device copy of a remote source's index; never synced. */
export interface TemplateCache {
  readIndex(source: CachedSourceId): Promise<CachedCatalogIndex | undefined>;
  writeIndex(source: CachedSourceId, index: CachedCatalogIndex): Promise<void>;
  /** `key` is "<source>/<file>"; a key that would leave the source's thumbnails folder is refused. */
  readThumbnail(key: string): Promise<Uint8Array | undefined>;
  writeThumbnail(key: string, bytes: Uint8Array): Promise<void>;
}
