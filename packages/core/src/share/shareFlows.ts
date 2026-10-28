// The share workflows: the device's registry of its shares, turning a folder of papers into a share, publishing it, opening a share link in the page, and revoking a share.
import { isSha256Hex, isShareId } from "../relay/index.js";
import { base64UrlToBytes, randomHex, bytesToBase64Url } from "../encoding/index.js";
import { formatShareLink, SHARE_LINK_KEY_BYTES, parseShareLink, type ShareLinkParts } from "./shareLink.js";
import type { Annotation } from "../model/index.js";
import {
  BLOB_OVERHEAD_BYTES,
  sealShareBlob,
  sealShareManifest,
  extractSharedMetadata,
  SHARE_MANIFEST_VERSION,
  type ShareManifest,
  type SharedPaper,
  type SharedPaperMetadata,
  type SharedPdf,
  openShareBlob,
  openShareManifest,
} from "./shareCrypto.js";
import type { ILogger } from "../ports/index.js";
import type { ShareBackend, ShareReader } from "./shareBackend.js";

// CONTRACT: documents/contracts/share-link.md#share-list
export interface ShareEntry {
  id: string;
  folder: string;
  relayUrl: string;
  /** The link key in base64url, so the device can show the link again. */
  key: string;
  createdAt: string;
  /** Every blob hash the share's manifest names. */
  blobs: string[];
}

export interface ShareRegistry { shares: ShareEntry[] }

/**
 * The text of `shares.json`; `read` answers undefined when the file does not exist, and `write` replaces it atomically.
 * `exclusive` runs one section at a time across every store of the same list, so a read-modify-write loses no other edit.
 */
export interface ShareRegistryStore {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
  exclusive<T>(run: () => Promise<T>): Promise<T>;
}

type Json = Record<string, unknown>;

function recordOf(value: unknown): ShareEntry | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const { id, folder, relayUrl, key, createdAt, blobs } = value as Json;
  const fields = [folder, relayUrl, key, createdAt];
  if (!isShareId(id) || !fields.every((field) => typeof field === "string")) { return undefined; }
  if (!Array.isArray(blobs) || !blobs.every((hash) => isSha256Hex(hash))) { return undefined; }
  return { id, folder: folder as string, relayUrl: relayUrl as string, key: key as string, createdAt: createdAt as string, blobs };
}

/** Throws when the file is not a share list, so no caller writes over the shares it still lists. */
export async function loadShareRegistry(store: ShareRegistryStore): Promise<ShareRegistry> {
  const text = await store.read();
  if (text === undefined) { return { shares: [] }; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The share list is not JSON (${String(error)}); fix or remove shares.json`);
  }
  const shares = (parsed as Json | null)?.["shares"];
  if (!Array.isArray(shares)) { throw new Error("The share list has no shares array; fix or remove shares.json"); }
  return { shares: shares.map(recordOf).filter((record): record is ShareEntry => record !== undefined) };
}

// CONTRACT: documents/contracts/share-link.md#share-list
/** Re-reads the list inside the store's exclusive section, so the change applies to what is listed now. */
export function updateShareRegistry(store: ShareRegistryStore, change: (registry: ShareRegistry) => ShareRegistry): Promise<void> {
  return store.exclusive(async () => {
    const changed = change(await loadShareRegistry(store));
    await store.write(`${JSON.stringify(changed, null, 2)}\n`);
  });
}

export function deriveShareLinkOfEntry(record: ShareEntry): string {
  return formatShareLink({ relayUrl: record.relayUrl, shareId: record.id, key: base64UrlToBytes(record.key) });
}

export interface SharePaperInput {
  metadata: SharedPaperMetadata;
  bib?: string;
  pdf?: Uint8Array;
  /** The sidecar's annotations; shared only when the share is made with annotations. */
  annotations?: readonly Annotation[];
}

/** `maxBlobBytes` is the largest stored value; a PDF that does not fit splits into parts of `partBytes`. */
export interface SharePartLimits { maxBlobBytes: number; partBytes: number }

export interface BuildShareInput {
  folderName: string;
  papers: readonly SharePaperInput[];
  withAnnotations: boolean;
  partLimits?: SharePartLimits;
}

export interface StoredShareBlob { hash: string; bytes: Uint8Array }

export interface BuiltShare {
  shareId: string;
  key: Uint8Array;
  manifest: ShareManifest;
  sealedManifest: Uint8Array;
  /** Each distinct blob once, in manifest order. */
  blobs: StoredShareBlob[];
}

// CONTRACT: documents/contracts/share-link.md#manifest
const MIB = 1024 * 1024;
const KV_LIMITS: SharePartLimits = { maxBlobBytes: 25 * MIB, partBytes: 20 * MIB };

function splitPdf(pdf: Uint8Array, limits: SharePartLimits): Uint8Array[] {
  if (pdf.length + BLOB_OVERHEAD_BYTES <= limits.maxBlobBytes) { return [pdf]; }
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < pdf.length; offset += limits.partBytes) { parts.push(pdf.subarray(offset, offset + limits.partBytes)); }
  return parts;
}

async function sharePdf(pdf: Uint8Array, limits: SharePartLimits, blobs: Map<string, StoredShareBlob>): Promise<SharedPdf> {
  const shared: SharedPdf = { size: pdf.length, parts: [] };
  for (const chunk of splitPdf(pdf, limits)) {
    const sealed = await sealShareBlob(chunk);
    shared.parts.push(sealed.part);
    blobs.set(sealed.part.blob, { hash: sealed.part.blob, bytes: sealed.bytes });
  }
  return shared;
}

export async function buildShare({ folderName, papers, withAnnotations, partLimits = KV_LIMITS }: BuildShareInput): Promise<BuiltShare> {
  const blobs = new Map<string, StoredShareBlob>();
  const shared: SharedPaper[] = [];
  for (const input of papers) {
    const metadata = extractSharedMetadata(input.metadata);
    if (!metadata) { throw new Error(`Cannot share paper "${String(input.metadata.id)}": it lacks an id, title or cite key`); }
    const paper: SharedPaper = { metadata };
    if (input.bib !== undefined) { paper.bib = input.bib; }
    if (withAnnotations && input.annotations) { paper.annotations = [...input.annotations]; }
    if (input.pdf && input.pdf.length > 0) { paper.pdf = await sharePdf(input.pdf, partLimits, blobs); }
    shared.push(paper);
  }
  const shareId = randomHex(16);
  const key = crypto.getRandomValues(new Uint8Array(SHARE_LINK_KEY_BYTES));
  const manifest: ShareManifest = { v: SHARE_MANIFEST_VERSION, folder: folderName, papers: shared };
  return { shareId, key, manifest, sealedManifest: await sealShareManifest(key, shareId, manifest), blobs: [...blobs.values()] };
}

export interface UploadShareOptions {
  share: BuiltShare;
  relayUrl: string;
  backend: ShareBackend;
  registry: ShareRegistryStore;
  logger: ILogger;
  now?: () => Date;
}

const MODULE = "share";

async function putShare(share: BuiltShare, backend: ShareBackend): Promise<number> {
  let uploaded = 0;
  for (const blob of share.blobs) {
    if (await backend.hasBlob(share.shareId, blob.hash)) { continue; }
    await backend.putBlob(share.shareId, blob.hash, blob.bytes);
    uploaded += 1;
  }
  // INVARIANT: the manifest goes last, so a link never names a blob the Worker lacks.
  await backend.putManifest(share.shareId, share.sealedManifest);
  return uploaded;
}

// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
/** Returns the share link. */
export async function uploadShare({ share, relayUrl, backend, registry, logger, now = () => new Date() }: UploadShareOptions): Promise<string> {
  const record = {
    id: share.shareId, folder: share.manifest.folder, relayUrl, key: bytesToBase64Url(share.key),
    createdAt: now().toISOString(), blobs: share.blobs.map((blob) => blob.hash),
  };
  // The share is listed before anything is uploaded, so whatever reaches the Worker can be revoked.
  await updateShareRegistry(registry, (listed) => ({ shares: [...listed.shares, record] }));
  const context = { shareId: share.shareId, relayUrl, papers: share.manifest.papers.length, blobs: share.blobs.length };
  try {
    const uploaded = await putShare(share, backend);
    await logger.log("INFO", MODULE, "Uploaded share", { ...context, uploaded });
  } catch (error) {
    await logger.error(MODULE, error, { ...context, action: "upload" });
    await removeShare(share.shareId, { registry, backendFor: () => backend, logger }).catch((cleanup: unknown) =>
      logger.error(MODULE, cleanup, { ...context, action: "revoke after failed upload; the share stays listed" }));
    throw error;
  }
  return formatShareLink({ relayUrl, shareId: share.shareId, key: share.key });
}

export type OpenShareError = "malformedLink" | "removed" | "unreadable" | "network";
export type LoadPdfError = "noPdf" | "missing" | "tampered" | "network";
/** `detail` says why a request failed, for the page's log. */
export type LoadPdfResult = { ok: true; bytes: Uint8Array } | { ok: false; error: LoadPdfError; detail?: string };

export interface OpenedShare {
  link: ShareLinkParts;
  manifest: ShareManifest;
  loadPdf(paper: SharedPaper): Promise<LoadPdfResult>;
}

export type OpenShareResult = { ok: true; share: OpenedShare } | { ok: false; error: OpenShareError; detail?: string };

async function loadPdf(reader: ShareReader, shareId: string, paper: SharedPaper): Promise<LoadPdfResult> {
  if (!paper.pdf) { return { ok: false, error: "noPdf" }; }
  const out = new Uint8Array(paper.pdf.size);
  let offset = 0;
  for (const part of paper.pdf.parts) {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await reader.fetchBlob(shareId, part.blob);
    } catch (error) {
      return { ok: false, error: "network", detail: `blob ${part.blob}: ${String(error)}` };
    }
    if (!bytes) { return { ok: false, error: "missing" }; }
    const plaintext = await openShareBlob(part, bytes);
    if (!plaintext) { return { ok: false, error: "tampered" }; }
    out.set(plaintext, offset);
    offset += plaintext.length;
  }
  return { ok: true, bytes: out };
}

/** Never throws: a bad link, a revoked share, a wrong key and an unreachable Worker are typed errors the page shows. */
export async function openShare(text: string, readerFor: (relayUrl: string) => ShareReader): Promise<OpenShareResult> {
  const parsed = parseShareLink(text);
  if (!parsed.ok) { return { ok: false, error: "malformedLink" }; }
  const { link } = parsed;
  const reader = readerFor(link.relayUrl);
  let sealed: Uint8Array | undefined;
  try {
    sealed = await reader.fetchManifest(link.shareId);
  } catch (error) {
    return { ok: false, error: "network", detail: `manifest of ${link.shareId}: ${String(error)}` };
  }
  if (!sealed) { return { ok: false, error: "removed" }; }
  const manifest = await openShareManifest(link.key, link.shareId, sealed);
  if (!manifest) { return { ok: false, error: "unreadable" }; }
  return { ok: true, share: { link, manifest, loadPdf: (paper) => loadPdf(reader, link.shareId, paper) } };
}

export interface RevokeShareOptions {
  registry: ShareRegistryStore;
  backendFor: (relayUrl: string) => ShareBackend;
  logger: ILogger;
}

// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
/** False when the device lists no such share. A failed delete rejects and keeps the entry, so revoking again finishes. */
export async function removeShare(shareId: string, { registry, backendFor, logger }: RevokeShareOptions): Promise<boolean> {
  const listed = await loadShareRegistry(registry);
  const record = listed.shares.find((share) => share.id === shareId);
  if (!record) {
    await logger.log("WARN", "share", "Revoke of a share this device does not list", { shareId });
    return false;
  }
  const others = listed.shares.filter((share) => share.id !== shareId);
  const kept = new Set(others.flatMap((share) => share.blobs));
  const doomed = [...new Set(record.blobs)].filter((hash) => !kept.has(hash));
  const backend = backendFor(record.relayUrl);
  try {
    // The manifest goes first: without it the link reads nothing, even while blobs remain.
    await backend.deleteManifest(shareId);
    for (const hash of doomed) { await backend.deleteBlob(shareId, hash); }
  } catch (error) {
    await logger.error("share", error, { shareId, relayUrl: record.relayUrl, action: "revoke" });
    throw error;
  }
  // INVARIANT: the network deletes run outside the section, so the entry is removed from the list as it is now, not as it was read.
  let racing: string[] = [];
  await updateShareRegistry(registry, (listed) => {
    const shares = listed.shares.filter((share) => share.id !== shareId);
    racing = shares.filter((share) => share.blobs.some((hash) => doomed.includes(hash))).map((share) => share.id);
    return { shares };
  });
  if (racing.length > 0) {
    await logger.log("WARN", "share", "A share listed during a revoke names a blob the revoke deleted; its PDF reads as missing", { shareId, racing });
  }
  await logger.log("INFO", "share", "Revoked share", { shareId, deletedBlobs: doomed.length, keptBlobs: record.blobs.length - doomed.length });
  return true;
}
