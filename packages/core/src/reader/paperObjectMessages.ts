// Answers the reader's paperObjects messages (the note editor's From paper… picker) through the host's optional paper-object port.
import { answerPaperObjectsRequest, unsupportedPaperObjectsReply, type PaperObjectsRequest } from "../paperObjects/protocol.js";
import type { MessageAnswers, ReaderHostPorts } from "./hostPorts.js";

/** Posts the port's answer, or "From paper is not available here." where the host has no port, so the picker never waits. */
async function answerReaderPaperObjects(ports: Pick<ReaderHostPorts, "paperObjects" | "post">, request: PaperObjectsRequest): Promise<void> {
  ports.post(ports.paperObjects ? await answerPaperObjectsRequest(ports.paperObjects, request) : unsupportedPaperObjectsReply(request));
}

export const paperObjectHandlers: Pick<MessageAnswers, "paperObjects"> = {
  paperObjects: (ctx, msg) => answerReaderPaperObjects(ctx.ports, msg.request),
};
