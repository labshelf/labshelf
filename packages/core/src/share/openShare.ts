// Opens a share link in the page: fetches and decrypts the manifest, then fetches, verifies and reassembles a PDF on demand.
import { openBlob, openManifest } from "./shareCipher.js";
import { parseShareLink, type ShareLinkParts } from "./shareLink.js";
import type { ShareManifest, SharedPaper } from "./shareManifest.js";
import type { ShareReader } from "./shareBackend.js";

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
    const plaintext = await openBlob(part, bytes);
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
  const manifest = await openManifest(link.key, link.shareId, sealed);
  if (!manifest) { return { ok: false, error: "unreadable" }; }
  return { ok: true, share: { link, manifest, loadPdf: (paper) => loadPdf(reader, link.shareId, paper) } };
}
