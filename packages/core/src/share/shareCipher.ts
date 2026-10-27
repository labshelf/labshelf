// Encrypts a share's manifest under its link key and its PDF parts convergently, and opens and verifies both.
import { openFrame, sealFrame, type FrameContext, type DerivedShareKey } from "../collab/invite/index.js";
import { hexToBytes } from "../encoding/index.js";
import { deriveSha256Hex } from "../hash/index.js";
import { decodeShareManifest, type ShareManifest, type SharedPdfPart } from "./shareManifest.js";

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
