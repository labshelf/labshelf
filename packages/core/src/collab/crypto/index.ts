/** Exports share keys, their derived keys and authenticated payload frames. */
export { SHARE_KEY_BYTES, deriveShareId, generateShareKey, rotateShareKey } from "./shareKey.js";
export type { ShareSecret } from "./shareKey.js";
export { deriveAwarenessKey, deriveContentKey, deriveRelayToken, deriveRoomCredentials } from "./derivedKeys.js";
export type { RoomCredentials } from "./derivedKeys.js";
export { openFrame, sealFrame } from "./frame.js";
export type { FrameContext, FrameError, OpenResult } from "./frame.js";
export type { WebCryptoKey } from "./hkdf.js";
