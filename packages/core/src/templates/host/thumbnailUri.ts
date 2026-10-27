// Turns a template thumbnail's bytes into a data: URI the gallery page can show, recognising PNG and WebP by their magic bytes.
import { bytesToBase64 } from "../../encoding/index.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8, after "RIFF" and the size.
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];

const startsWith = (bytes: Uint8Array, magic: number[], offset = 0): boolean => magic.every((b, i) => bytes[offset + i] === b);

/** @returns the data: URI of a PNG or WebP image, or undefined for any other bytes (a page must never render unknown content) */
export function createThumbnailUri(bytes: Uint8Array): string | undefined {
  const mime = startsWith(bytes, PNG_MAGIC) ? "image/png"
    : startsWith(bytes, RIFF_MAGIC) && startsWith(bytes, WEBP_TAG, 8) ? "image/webp"
    : undefined;
  return mime ? `data:${mime};base64,${bytesToBase64(bytes)}` : undefined;
}
