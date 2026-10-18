// Seals a doc payload into the frame of a share message and opens one, checking it names the doc its envelope files it under.
import { bytesToHex } from "../../../encoding/index.js";
import { openFrame, sealFrame, type FrameError, type WebCryptoKey } from "../../crypto/index.js";
import { deriveDocId } from "./docId.js";
import { decodeDocPayload, encodeDocPayload } from "./docPayload.js";
import type { Envelope } from "./envelope.js";

/** The share, key and payload kind name a frame is bound to. */
export interface DocFrameContext { shareId: string; key: WebCryptoKey; name: string }

export type OpenedDocFrame =
  | { ok: true; docKey: string; payload: Uint8Array }
  | { ok: false; error: FrameError | "docMismatch" };

/** Derives doc ids once per doc key, since every message of a doc needs its id. */
export function docIdCache(shareId: string): (docKey: string) => Promise<Uint8Array> {
  const ids = new Map<string, Promise<Uint8Array>>();
  return (docKey) => {
    let id = ids.get(docKey);
    if (!id) {
      id = deriveDocId(shareId, docKey);
      ids.set(docKey, id);
    }
    return id;
  };
}

// CONTRACT: documents/contracts/collaboration.md#messages
export function sealDocFrame(context: DocFrameContext, docId: Uint8Array, docKey: string, payload: Uint8Array): Promise<Uint8Array> {
  return sealFrame(context.key, frameContext(context, docId), encodeDocPayload(docKey, payload));
}

export async function openDocFrame(
  context: DocFrameContext, envelope: Envelope, docIdOf: (docKey: string) => Promise<Uint8Array>,
): Promise<OpenedDocFrame> {
  const opened = await openFrame(context.key, frameContext(context, envelope.docId), envelope.frame);
  if (!opened.ok) { return opened; }
  const message = decodeDocPayload(opened.bytes);
  // INVARIANT: the header doc id is what a relay files the frame under, so it must name the doc the plaintext edits.
  if (!message || bytesToHex(await docIdOf(message.docKey)) !== bytesToHex(envelope.docId)) { return { ok: false, error: "docMismatch" }; }
  return { ok: true, docKey: message.docKey, payload: message.payload };
}

function frameContext(context: DocFrameContext, docId: Uint8Array) {
  return { shareId: context.shareId, docKey: bytesToHex(docId), kind: context.name };
}
