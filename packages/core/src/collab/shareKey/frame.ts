// Seals and opens payload frames with AES-GCM bound to their share, doc and payload kind.
import type { DerivedShareKey } from "./hkdf.js";

const FRAME_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES;

export interface FrameContext {
  shareId: string;
  docKey: string;
  /** Payload kind, such as "update", "snapshot", "awareness" or "blob". */
  kind: string;
}

export type FrameError = "badVersion" | "tooShort" | "authFailed";
export type OpenResult = { ok: true; bytes: Uint8Array } | { ok: false; error: FrameError };

// Each field is length-prefixed so no two contexts encode to the same bytes, which stops a frame being replayed into another doc or kind.
function additionalData(context: FrameContext): Uint8Array<ArrayBuffer> {
  const fields = [context.shareId, context.docKey, context.kind].map((field) => new TextEncoder().encode(field));
  const out = new Uint8Array(1 + fields.reduce((sum, field) => sum + 4 + field.length, 0));
  const view = new DataView(out.buffer);
  out[0] = FRAME_VERSION;
  let offset = 1;
  for (const field of fields) {
    view.setUint32(offset, field.length);
    out.set(field, offset + 4);
    offset += 4 + field.length;
  }
  return out;
}

export async function sealFrame(key: DerivedShareKey, context: FrameContext, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(context) },
    key,
    plaintext as Uint8Array<ArrayBuffer>,
  );
  const frame = new Uint8Array(HEADER_BYTES + sealed.byteLength);
  frame[0] = FRAME_VERSION;
  frame.set(nonce, 1);
  frame.set(new Uint8Array(sealed), HEADER_BYTES);
  return frame;
}

/** Never throws on hostile input: every failure is a typed result. */
export async function openFrame(key: DerivedShareKey, context: FrameContext, frame: Uint8Array): Promise<OpenResult> {
  if (frame.length < 1) { return { ok: false, error: "tooShort" }; }
  if (frame[0] !== FRAME_VERSION) { return { ok: false, error: "badVersion" }; }
  if (frame.length < HEADER_BYTES + TAG_BYTES) { return { ok: false, error: "tooShort" }; }
  try {
    const bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: frame.slice(1, HEADER_BYTES), additionalData: additionalData(context) },
      key,
      frame.slice(HEADER_BYTES),
    );
    return { ok: true, bytes: new Uint8Array(bytes) };
  } catch {
    // WebCrypto signals a failed tag check only by rejecting; any rejection here means the frame is not authentic for this key and context.
    return { ok: false, error: "authFailed" };
  }
}
