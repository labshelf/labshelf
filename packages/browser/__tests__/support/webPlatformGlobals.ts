// Gives jsdom test files the Web Crypto and text codecs that the collab code reads from globalThis.
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";

if ((globalThis as { crypto?: Crypto }).crypto?.subtle === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
if (typeof globalThis.TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder, configurable: true });
  Object.defineProperty(globalThis, "TextDecoder", { value: TextDecoder, configurable: true });
}
