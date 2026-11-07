/** Exports a share's key: generating, identifying and rotating it, the per-purpose keys derived from it, and the sealed payload frames. Collab and share both reach it here, so neither imports the other for it. */
export {
  SHARE_KEY_BYTES, createNextShareKey, createShareKey, deriveContentShareKey, derivePresenceShareKey, deriveRelayToken, deriveShareId,
  openFrame, sealFrame,
} from "./shareKey.js";
export type { DerivedShareKey, FrameContext, FrameError, OpenResult, ShareSecret } from "./shareKey.js";
