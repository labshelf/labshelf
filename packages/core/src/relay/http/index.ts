/** Exports the relay endpoints and the codec of their JSON bodies. */
export {
  encodeRelayBody, RELAY_PATH, RELAY_REFUSAL,
  type ClaimRequest, type ClaimResponse, type Refusal, type TicketRequest, type TicketResponse, type VersionResponse,
} from "./httpBodies.js";
export { isSha256Hex, isShareId } from "./bodyFields.js";
export { decodeClaimRequest, decodeTicketRequest, type RequestResult } from "./decodeRequestBody.js";
export {
  decodeClaimResponse, decodeRefusal, decodeTicketResponse, decodeVersionResponse, type ResponseResult,
} from "./decodeResponseBody.js";
