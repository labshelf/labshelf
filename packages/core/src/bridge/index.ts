/** Exports the runtime-neutral bridge protocol: messages, framing, file chunks and validation. */
export {
  assertSameProtocol, BRIDGE_CHUNK_BYTES, BRIDGE_HOST_NAME, BRIDGE_PROTOCOL, BROWSER_MESSAGE_LIMIT, encodeFrame, FrameDecoder,
  HOST_MESSAGE_LIMIT, parseBridgeRequest, parseRequestId, splitFileChunks,
  type BridgeChangedEvent, type BridgeErrorBody, type BridgeErrorCode, type BridgeOp, type BridgeReadChunk,
  type BridgeRequest, type BridgeResponse, type BridgeResults, type HelloResult, type HostMessage,
} from "./protocol.js";
export { BridgeError } from "./bridgeError.js";
