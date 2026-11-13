/** Exports the runtime-neutral consult port: the refs, requests and replies of the consult window with their guards, and the answers over the host's IO. The DOM part (EditableFile) is in ./dom. */
export { isConsultRequest, isConsultReply } from "./consultRequests.js";
export type { ConsultRef, ConsultKind, ConsultEntry, ConsultRequest, ConsultValue, ConsultReply, ConsultContext } from "./consultRequests.js";
export { answerConsult } from "./answerConsult.js";
export type { ConsultIo } from "./answerConsult.js";
