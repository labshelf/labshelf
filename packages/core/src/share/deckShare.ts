// A deck shared by link: its single-file HTML in convergent parts under a deck manifest sealed apart from the paper manifest, building and uploading it, and opening any share link as a folder or a deck.
import { isRecord, isString } from "../guards/index.js";
import { deriveShareId, openFrame, sealFrame, type FrameContext, type DerivedShareKey } from "../collab/index.js";
import { bytesToBase64Url } from "../encoding/index.js";
import { isDeckSizeAllowed, parseDeckSize } from "../decks/index.js";
import type { ILogger } from "../ports/index.js";
import { hkdfBits, isShareSize, sealShareBlob, sharedPartsOf, type SharedPdfPart } from "./shareCrypto.js";
import { formatShareLink, parseShareLink, resolveShareLink, SHARE_LINK_KEY_BYTES, type ShareLinkParts } from "./shareLink.js";
import type { ShareBackend, ShareReader } from "./shareBackend.js";
import {
  joinSharedParts, openShare, runListedUpload, updateShareRegistry,
  type LoadPdfError, type OpenedShare, type OpenShareError, type ShareEntry, type ShareRegistryStore,
} from "./shareFlows.js";

// CONTRACT: documents/contracts/share-link.md#deck
export interface DeckShareManifest { v: 1; kind: "deck"; title: string; deck: "talk" | "poster"; size: string; bytes: number; parts: SharedPdfPart[] }


/** Undefined for anything but a deck manifest of version 1 whose parts add up to its bytes; unknown fields are dropped. */
export function decodeDeckShareManifest(value: unknown): DeckShareManifest | undefined {
  if (!isRecord(value) || value["v"] !== 1 || value["kind"] !== "deck" || !isString(value["title"])) { return undefined; }
  const deck = value["deck"];
  if (deck !== "talk" && deck !== "poster") { return undefined; }
  const size = value["size"];
  const parsed = isString(size) ? parseDeckSize(size) : null;
  if (!isString(size) || !parsed || !isDeckSizeAllowed(deck, parsed)) { return undefined; }
  const parts = sharedPartsOf(value["parts"]);
  if (!isShareSize(value["bytes"]) || !parts) { return undefined; }
  if (parts.reduce((sum, part) => sum + part.size, 0) !== value["bytes"]) { return undefined; }
  return { v: 1, kind: "deck", title: value["title"], deck, size, bytes: value["bytes"], parts };
}

// CONTRACT: documents/contracts/share-link.md#deck
const DECK_MANIFEST_INFO = "labshelf-share-deck-manifest";

const deckManifestContext = (shareId: string): FrameContext => ({ shareId, docKey: "manifest", kind: "share-deck-manifest" });

async function deckManifestKey(linkKey: Uint8Array): Promise<DerivedShareKey> {
  const raw = await hkdfBits(linkKey, DECK_MANIFEST_INFO, 32);
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealDeckManifest(linkKey: Uint8Array, shareId: string, manifest: DeckShareManifest): Promise<Uint8Array> {
  return sealFrame(await deckManifestKey(linkKey), deckManifestContext(shareId), new TextEncoder().encode(JSON.stringify(manifest)));
}

/** Undefined when the bytes do not open under this key and share id as a deck manifest, or do not hold a valid one. */
export async function openDeckManifest(linkKey: Uint8Array, shareId: string, sealed: Uint8Array): Promise<DeckShareManifest | undefined> {
  const opened = await openFrame(await deckManifestKey(linkKey), deckManifestContext(shareId), sealed);
  if (!opened.ok) { return undefined; }
  try {
    return decodeDeckShareManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.bytes)));
  } catch {
    // An authentic frame that is not UTF-8 JSON came from a broken writer; it reads as no manifest, like a forged one.
    return undefined;
  }
}

export interface BuiltDeckShare { shareId: string; key: Uint8Array; manifest: DeckShareManifest; blobs: { name: string; bytes: Uint8Array }[] }

// CONTRACT: documents/contracts/share-link.md#manifest (the paper part size, under the 25 MiB KV value limit)
const DEFAULT_PART_BYTES = 20 * 1024 * 1024;

export async function buildDeckShare(input: { title: string; deck: "talk" | "poster"; size: string; html: string; partLimits?: { partBytes: number } }): Promise<BuiltDeckShare> {
  const partBytes = input.partLimits?.partBytes ?? DEFAULT_PART_BYTES;
  if (!Number.isSafeInteger(partBytes) || partBytes <= 0) { throw new Error(`Cannot share deck "${input.title}": part size ${String(partBytes)} is not a positive integer`); }
  const bytes = new TextEncoder().encode(input.html);
  const parts: SharedPdfPart[] = [];
  const blobs = new Map<string, Uint8Array>();
  for (let offset = 0; offset < bytes.length; offset += partBytes) {
    const sealed = await sealShareBlob(bytes.subarray(offset, offset + partBytes));
    parts.push(sealed.part);
    blobs.set(sealed.part.blob, sealed.bytes);
  }
  const manifest: DeckShareManifest = { v: 1, kind: "deck", title: input.title, deck: input.deck, size: input.size, bytes: bytes.length, parts };
  const key = crypto.getRandomValues(new Uint8Array(SHARE_LINK_KEY_BYTES));
  return {
    shareId: await deriveShareId(key),
    key,
    manifest,
    blobs: [...blobs].map(([name, sealed]) => ({ name, bytes: sealed })),
  };
}


// CONTRACT: documents/contracts/share-link.md#upload-and-revoke
/** Returns the share link. Lists the share first, uploads blobs before the manifest, and revokes what reached the Worker when a step fails. */
export async function uploadDeckShare(options: { share: BuiltDeckShare; relayUrl: string; backend: ShareBackend; registry: ShareRegistryStore; logger: ILogger; now?: () => Date }): Promise<string> {
  const { share, relayUrl, backend, registry, logger, now = () => new Date() } = options;
  const record: ShareEntry = {
    id: share.shareId, folder: share.manifest.title, relayUrl, key: bytesToBase64Url(share.key),
    createdAt: now().toISOString(), blobs: share.blobs.map((blob) => blob.name), kind: "deck",
  };
  await updateShareRegistry(registry, (listed) => ({ shares: [...listed.shares, record] }));
  const context = { shareId: share.shareId, relayUrl, deck: share.manifest.deck, blobs: share.blobs.length };
  await runListedUpload({
    shareId: share.shareId, backend, registry, logger, context, label: "Uploaded deck share",
    upload: async () => {
      let uploaded = 0;
      for (const blob of share.blobs) {
        if (await backend.hasBlob(share.shareId, blob.name)) { continue; }
        await backend.putBlob(share.shareId, blob.name, blob.bytes);
        uploaded += 1;
      }
      // INVARIANT: the manifest goes last, so a link never names a blob the Worker lacks.
      await backend.putManifest(share.shareId, await sealDeckManifest(share.key, share.shareId, share.manifest));
      return uploaded;
    },
  });
  return formatShareLink({ relayUrl, key: share.key });
}

export type OpenedAnyShare = { kind: "folder"; share: OpenedShare } | { kind: "deck"; link: ShareLinkParts; manifest: DeckShareManifest; loadHtml(): Promise<{ ok: true; html: string } | { ok: false; error: LoadPdfError; detail?: string }> };

async function loadHtml(reader: ShareReader, shareId: string, manifest: DeckShareManifest): Promise<{ ok: true; html: string } | { ok: false; error: LoadPdfError; detail?: string }> {
  const joined = await joinSharedParts(reader, shareId, manifest.parts, manifest.bytes);
  if (!joined.ok) { return joined; }
  const out = joined.bytes;
  try {
    return { ok: true, html: new TextDecoder("utf-8", { fatal: true }).decode(out) };
  } catch {
    // Every part verified, so bytes that are not UTF-8 were written broken; the page treats them like a tampered part.
    return { ok: false, error: "tampered", detail: "the deck HTML is not UTF-8" };
  }
}

/**
 * Never throws: opens the link through openShare, so a paper link gives exactly its result, and when the manifest does not open as paper
 * tries the same fetched bytes as a deck manifest; a link that opens as neither is unreadable.
 */
export async function openAnyShare(text: string, readerFor: (relayUrl: string) => ShareReader): Promise<{ ok: true; opened: OpenedAnyShare } | { ok: false; error: OpenShareError; detail?: string }> {
  let used: { reader: ShareReader; sealed: Uint8Array } | undefined;
  const paper = await openShare(text, (relayUrl) => {
    const reader = readerFor(relayUrl);
    return {
      fetchManifest: async (shareId) => {
        const sealed = await reader.fetchManifest(shareId);
        if (sealed) { used = { reader, sealed }; }
        return sealed;
      },
      fetchBlob: (shareId, hash) => reader.fetchBlob(shareId, hash),
    };
  });
  if (paper.ok) { return { ok: true, opened: { kind: "folder", share: paper.share } }; }
  if (paper.error !== "unreadable" || !used) { return paper; }
  const parsed = parseShareLink(text);
  if (!parsed.ok) { return { ok: false, error: "malformedLink" }; }
  const link = await resolveShareLink(parsed.link);
  const { reader, sealed } = used;
  const deck = await openDeckManifest(link.key, link.shareId, sealed);
  if (!deck) { return { ok: false, error: "unreadable" }; }
  return { ok: true, opened: { kind: "deck", link, manifest: deck, loadHtml: () => loadHtml(reader, link.shareId, deck) } };
}
