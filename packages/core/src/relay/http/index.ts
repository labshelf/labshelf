/** Exports the relay endpoints and the codec of their JSON bodies. */
export {
  encodeRelayBody, RELAY_PATH, RELAY_REFUSAL,
  type ClaimRequest, type ClaimResponse, type IceServer, type Refusal, type TicketRequest, type TicketResponse, type TurnRequest,
  type TurnResponse, type VersionResponse,
} from "./httpBodies.js";
export { isShareId } from "./bodyFields.js";
export { decodeClaimRequest, decodeTicketRequest, decodeTurnRequest, type RequestResult } from "./decodeRequestBody.js";
export {
  decodeClaimResponse, decodeRefusal, decodeTicketResponse, decodeTurnResponse, decodeVersionResponse, type ResponseResult,
} from "./decodeResponseBody.js";
