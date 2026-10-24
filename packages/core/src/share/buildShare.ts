// Turns a folder of papers into a share: a fresh id and link key, the sealed manifest and the distinct encrypted PDF parts.
import { bytesToHex } from "../encoding/index.js";
import type { Annotation } from "../model/index.js";
import { BLOB_OVERHEAD_BYTES, sealBlob, sealManifest } from "./shareCipher.js";
import { SHARE_LINK_KEY_BYTES } from "./shareLink.js";
import { sharedMetadataOf, SHARE_MANIFEST_VERSION, type ShareManifest, type SharedPaper, type SharedPaperMetadata, type SharedPdf } from "./shareManifest.js";

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

export interface StoredBlob { hash: string; bytes: Uint8Array }

export interface BuiltShare {
  shareId: string;
  key: Uint8Array;
  manifest: ShareManifest;
  sealedManifest: Uint8Array;
  /** Each distinct blob once, in manifest order. */
  blobs: StoredBlob[];
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

async function sharePdf(pdf: Uint8Array, limits: SharePartLimits, blobs: Map<string, StoredBlob>): Promise<SharedPdf> {
  const shared: SharedPdf = { size: pdf.length, parts: [] };
  for (const chunk of splitPdf(pdf, limits)) {
    const sealed = await sealBlob(chunk);
    shared.parts.push(sealed.part);
    blobs.set(sealed.part.blob, { hash: sealed.part.blob, bytes: sealed.bytes });
  }
  return shared;
}

export async function buildShare({ folderName, papers, withAnnotations, partLimits = KV_LIMITS }: BuildShareInput): Promise<BuiltShare> {
  const blobs = new Map<string, StoredBlob>();
  const shared: SharedPaper[] = [];
  for (const input of papers) {
    const metadata = sharedMetadataOf(input.metadata);
    if (!metadata) { throw new Error(`Cannot share paper "${String(input.metadata.id)}": it lacks an id, title or cite key`); }
    const paper: SharedPaper = { metadata };
    if (input.bib !== undefined) { paper.bib = input.bib; }
    if (withAnnotations && input.annotations) { paper.annotations = [...input.annotations]; }
    if (input.pdf && input.pdf.length > 0) { paper.pdf = await sharePdf(input.pdf, partLimits, blobs); }
    shared.push(paper);
  }
  const shareId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = crypto.getRandomValues(new Uint8Array(SHARE_LINK_KEY_BYTES));
  const manifest: ShareManifest = { v: SHARE_MANIFEST_VERSION, folder: folderName, papers: shared };
  return { shareId, key, manifest, sealedManifest: await sealManifest(key, shareId, manifest), blobs: [...blobs.values()] };
}
