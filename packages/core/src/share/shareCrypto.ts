// Declares a share's manifest and reads one from untrusted JSON, then encrypts it under the share's link key and its PDF parts convergently, and opens and verifies both.
import { isNumber, isRecord, isString, isStringArray } from "../guards/index.js";
import { BIBLIOGRAPHIC_STRING_FIELDS, type Annotation, type BibliographicFields } from "../model/index.js";
import { normalizePaperSidecar } from "../reader/index.js";
import { isSha256Hex } from "../relay/index.js";
import { openFrame, sealFrame, type FrameContext, type DerivedShareKey } from "../collab/invite/index.js";
import { hexToBytes } from "../encoding/index.js";
import { deriveSha256Hex } from "../hash/index.js";

// CONTRACT: documents/contracts/share-link.md#manifest
export const SHARE_MANIFEST_VERSION = 1;

export interface SharedPaperMetadata extends BibliographicFields {
  id: string;
  title: string;
  citeKey: string;
}

/** `blob` names the stored ciphertext; `content` is the plaintext's SHA-256, from which the part's key derives. */
export interface SharedPdfPart { blob: string; content: string; size: number }
export interface SharedPdf { size: number; parts: SharedPdfPart[] }

export interface SharedPaper {
  metadata: SharedPaperMetadata;
  bib?: string;
  annotations?: Annotation[];
  pdf?: SharedPdf;
}

export interface ShareManifest {
  v: typeof SHARE_MANIFEST_VERSION;
  folder: string;
  papers: SharedPaper[];
}

const isSize = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The shareable fields of a paper; the user's own fields (status, tags, note, files) never pass. */
export function extractSharedMetadata(value: unknown): SharedPaperMetadata | undefined {
  if (!isRecord(value) || !isString(value["id"]) || !isString(value["title"]) || !isString(value["citeKey"])) { return undefined; }
  const metadata: SharedPaperMetadata = { id: value["id"], title: value["title"], citeKey: value["citeKey"] };
  if (isStringArray(value["authors"])) { metadata.authors = value["authors"]; }
  if (isNumber(value["year"])) { metadata.year = value["year"]; }
  for (const field of BIBLIOGRAPHIC_STRING_FIELDS) {
    const text = value[field];
    if (isString(text)) { metadata[field] = text; }
  }
  if (isStringArray(value["keywords"])) { metadata.keywords = value["keywords"]; }
  return metadata;
}

function pdfOf(value: unknown): SharedPdf | undefined {
  if (!isRecord(value) || !isSize(value["size"]) || !Array.isArray(value["parts"])) { return undefined; }
  const parts: SharedPdfPart[] = [];
  for (const part of value["parts"]) {
    if (!isRecord(part) || !isSha256Hex(part["blob"]) || !isSha256Hex(part["content"]) || !isSize(part["size"])) { return undefined; }
    parts.push({ blob: part["blob"], content: part["content"], size: part["size"] });
  }
  const total = parts.reduce((sum, part) => sum + part.size, 0);
  return parts.length > 0 && total === value["size"] ? { size: total, parts } : undefined;
}

function paperOf(value: unknown): SharedPaper | undefined {
  const metadata = isRecord(value) ? extractSharedMetadata(value["metadata"]) : undefined;
  if (!isRecord(value) || !metadata) { return undefined; }
  const paper: SharedPaper = { metadata };
  if (isString(value["bib"])) { paper.bib = value["bib"]; }
  if (Array.isArray(value["annotations"])) { paper.annotations = normalizePaperSidecar({ annotations: value["annotations"] }).annotations; }
  const pdf = pdfOf(value["pdf"]);
  if (pdf) { paper.pdf = pdf; }
  return paper;
}

/** Undefined for anything but a manifest of this version; a malformed paper is dropped, a malformed PDF reads as none. */
export function decodeShareManifest(value: unknown): ShareManifest | undefined {
  if (!isRecord(value) || value["v"] !== SHARE_MANIFEST_VERSION || !isString(value["folder"]) || !Array.isArray(value["papers"])) {
    return undefined;
  }
  const papers = value["papers"].map(paperOf).filter((paper): paper is SharedPaper => paper !== undefined);
  return { v: SHARE_MANIFEST_VERSION, folder: value["folder"], papers };
}

// CONTRACT: documents/contracts/share-link.md#encryption
const MANIFEST_INFO = "labshelf-share-manifest";
const BLOB_INFO = "labshelf-share-blob";
const BLOB_VERSION = 1;
const NONCE_BYTES = 12;
/** What sealing adds to a part: the version byte and the AES-GCM tag. */
export const BLOB_OVERHEAD_BYTES = 1 + 16;

const manifestContext = (shareId: string): FrameContext => ({ shareId, docKey: "manifest", kind: "share-manifest" });

async function hkdfBits(ikm: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", ikm as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveBits"]);
  const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) };
  return new Uint8Array(await crypto.subtle.deriveBits(params, base, bytes * 8));
}

function aesKey(raw: Uint8Array): Promise<DerivedShareKey> {
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function manifestKey(linkKey: Uint8Array): Promise<DerivedShareKey> {
  return aesKey(await hkdfBits(linkKey, MANIFEST_INFO, 32));
}

export async function sealShareManifest(linkKey: Uint8Array, shareId: string, manifest: ShareManifest): Promise<Uint8Array> {
  return sealFrame(await manifestKey(linkKey), manifestContext(shareId), new TextEncoder().encode(JSON.stringify(manifest)));
}

/** Undefined when the bytes do not open under this key and share id, or do not hold a manifest of this version. */
export async function openShareManifest(linkKey: Uint8Array, shareId: string, sealed: Uint8Array): Promise<ShareManifest | undefined> {
  const opened = await openFrame(await manifestKey(linkKey), manifestContext(shareId), sealed);
  if (!opened.ok) { return undefined; }
  try {
    return decodeShareManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.bytes)));
  } catch {
    // An authentic frame that is not UTF-8 JSON came from a broken writer; it reads as no manifest, like a forged one.
    return undefined;
  }
}

// INVARIANT: the key and nonce derive from the plaintext's hash, so a key only ever seals that one plaintext and the fixed nonce is safe.
async function blobCipher(contentHash: string): Promise<{ key: DerivedShareKey; iv: Uint8Array<ArrayBuffer> }> {
  const bits = await hkdfBits(hexToBytes(contentHash), BLOB_INFO, 32 + NONCE_BYTES);
  return { key: await aesKey(bits.subarray(0, 32)), iv: bits.slice(32) };
}

export interface SealedShareBlob { part: SharedPdfPart; bytes: Uint8Array }

export async function sealShareBlob(plaintext: Uint8Array): Promise<SealedShareBlob> {
  const content = await deriveSha256Hex(plaintext);
  const { key, iv } = await blobCipher(content);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext as Uint8Array<ArrayBuffer>);
  const bytes = new Uint8Array(1 + sealed.byteLength);
  bytes[0] = BLOB_VERSION;
  bytes.set(new Uint8Array(sealed), 1);
  return { part: { blob: await deriveSha256Hex(bytes), content, size: plaintext.length }, bytes };
}

/** Undefined unless the bytes hash to the part's blob, open under its key, and decrypt to its content hash and size. */
export async function openShareBlob(part: SharedPdfPart, bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (bytes[0] !== BLOB_VERSION || (await deriveSha256Hex(bytes)) !== part.blob) { return undefined; }
  const { key, iv } = await blobCipher(part.content);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(1)));
  } catch {
    // PLATFORM: WebCrypto reports a failed tag check only by rejecting.
    return undefined;
  }
  return plaintext.length === part.size && (await deriveSha256Hex(plaintext)) === part.content ? plaintext : undefined;
}
