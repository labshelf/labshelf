/** Exports the runtime-neutral bridge protocol: messages, framing, file chunks and validation. */
export {
  BRIDGE_CHUNK_BYTES, BRIDGE_HOST_NAME, BRIDGE_PROTOCOL, BROWSER_MESSAGE_LIMIT, HOST_MESSAGE_LIMIT,
  type BridgeChangedEvent, type BridgeErrorBody, type BridgeErrorCode, type BridgeOp, type BridgeReadChunk,
  type BridgeRequest, type BridgeResponse, type BridgeResults, type HelloResult, type HostMessage,
} from "./protocol.js";
export { BridgeError } from "./bridgeError.js";
export { encodeFrame, FrameDecoder } from "./framing.js";
export { splitFileChunks } from "./fileChunks.js";
export { assertSameProtocol, parseBridgeRequest, parseRequestId } from "./requestValidation.js";
