/** Exports the runtime-neutral bridge: the protocol (messages, framing, file chunks, validation) and the client over a native port. */
export {
  assertSameProtocol, BRIDGE_CHUNK_BYTES, BRIDGE_HOST_NAME, BRIDGE_PROTOCOL, BROWSER_MESSAGE_LIMIT, encodeFrame, FrameDecoder,
  HOST_MESSAGE_LIMIT, parseBridgeRequest, parseRequestId, splitFileChunks,
  type BridgeChangedEvent, type BridgeErrorBody, type BridgeErrorCode, type BridgeOp, type BridgeReadChunk,
  type BridgeRequest, type BridgeResponse, type BridgeResults, type HelloResult, type HostMessage,
} from "./protocol.js";
export { BridgeError } from "./bridgeError.js";
export { BridgeClosedError, BridgeConnection, type BridgeCall } from "./bridgeConnection.js";
export { BridgeClient, deriveBridgeFailure, setBridgeLibrary, type BridgeFailure, type BridgeFailureKind, type OpenBridge } from "./connectBridge.js";
export { BridgeFileSystem } from "./bridgeFileSystem.js";
export { isHostNotFound } from "./hostNotFound.js";
