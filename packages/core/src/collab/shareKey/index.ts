/** Exports share keys, their derived keys and authenticated payload frames. */
export { SHARE_KEY_BYTES, deriveShareId, createShareKey, createNextShareKey } from "./shareKey.js";
export type { ShareSecret } from "./shareKey.js";
export { derivePresenceShareKey, deriveContentShareKey, deriveRelayToken } from "./deriveShareKeys.js";
export { openFrame, sealFrame } from "./frame.js";
export type { FrameContext, FrameError, OpenResult } from "./frame.js";
export type { DerivedShareKey } from "./hkdf.js";
