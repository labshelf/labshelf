// Seals the update and snapshot messages a relay stores and opens the ones it returns, all with epoch and `seq` 0.
import type { WebCryptoKey } from "../shareKey/index.js";
import { decodeEnvelope, encodeEnvelope, MESSAGE_KIND, openDocFrame, sealDocFrame } from "../peer/index.js";

// CONTRACT: documents/contracts/relay.md#client-obligations
const STORED_KIND_NAME: Record<number, string> = { [MESSAGE_KIND.update]: "update", [MESSAGE_KIND.syncStep2]: "syncStep2" };

export interface StoredFrameContext { shareId: string; key: WebCryptoKey; docIdOf: (docKey: string) => Promise<Uint8Array> }

export async function sealStored(
  context: StoredFrameContext, kind: typeof MESSAGE_KIND.update | typeof MESSAGE_KIND.syncStep2, docKey: string, payload: Uint8Array,
): Promise<{ docId: Uint8Array; message: Uint8Array }> {
  const docId = await context.docIdOf(docKey);
  const frame = await sealDocFrame({ shareId: context.shareId, key: context.key, name: STORED_KIND_NAME[kind]! }, docId, docKey, payload);
  return { docId, message: encodeEnvelope({ kind, epoch: 0n, seq: 0, docId, frame }) };
}

/** The Yjs update a stored message carries; undefined for anything that is not a stored kind of this doc or fails to open. */
export async function openStored(context: StoredFrameContext, docKey: string, bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const decoded = decodeEnvelope(bytes);
  const name = decoded.ok ? STORED_KIND_NAME[decoded.envelope.kind] : undefined;
  if (!decoded.ok || !name) { return undefined; }
  const opened = await openDocFrame({ shareId: context.shareId, key: context.key, name }, decoded.envelope, context.docIdOf);
  return opened.ok && opened.docKey === docKey ? opened.payload : undefined;
}
