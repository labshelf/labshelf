// Generates, identifies and rotates a share's key, derives its per-purpose keys with HKDF-SHA-256, and seals and opens payload frames.
import { bytesToBase64Url, bytesToHex } from "../../encoding/index.js";

// The share key is uniformly random, so HKDF needs no salt to extract (RFC 5869 §3.1); an empty salt keeps derivation reproducible from the key alone.
const HKDF_SALT = new Uint8Array(0);

// PLATFORM: Node's types declare CryptoKey only under node:crypto, so the type comes from the global crypto every runtime has.
export type DerivedShareKey = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

type DerivationLabel = "share-id" | "content" | "awareness" | "relay";

async function importShareKey(shareKey: Uint8Array): Promise<DerivedShareKey> {
  return crypto.subtle.importKey("raw", shareKey as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveBits", "deriveKey"]);
}

function hkdfParams(label: DerivationLabel) {
  return { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: new TextEncoder().encode(label) };
}

async function deriveBytes(shareKey: Uint8Array, label: DerivationLabel, length: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(hkdfParams(label), await importShareKey(shareKey), length * 8);
  return new Uint8Array(bits);
}

async function deriveAesShareKey(shareKey: Uint8Array, label: "content" | "awareness"): Promise<DerivedShareKey> {
  return crypto.subtle.deriveKey(
    hkdfParams(label),
    await importShareKey(shareKey),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const SHARE_KEY_BYTES = 16;

export interface ShareSecret {
  shareKey: Uint8Array;
  shareId: string;
}

export function createShareKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SHARE_KEY_BYTES));
}

/** The share id names the share publicly without revealing the key. */
export async function deriveShareId(shareKey: Uint8Array): Promise<string> {
  return bytesToHex(await deriveBytes(shareKey, "share-id", 16));
}

/** Frames sealed under `previous` stay readable only to whoever keeps it. */
export async function createNextShareKey(current: ShareSecret): Promise<{ previous: ShareSecret; next: ShareSecret }> {
  const shareKey = createShareKey();
  return { previous: current, next: { shareKey, shareId: await deriveShareId(shareKey) } };
}

export function deriveContentShareKey(shareKey: Uint8Array): Promise<DerivedShareKey> {
  return deriveAesShareKey(shareKey, "content");
}

export function derivePresenceShareKey(shareKey: Uint8Array): Promise<DerivedShareKey> {
  return deriveAesShareKey(shareKey, "awareness");
}

export async function deriveRelayToken(shareKey: Uint8Array): Promise<string> {
  return bytesToBase64Url(await deriveBytes(shareKey, "relay", 32));
}

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
