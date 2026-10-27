/** Turns an untrusted frame into a typed helper protocol message or a typed rejection, without throwing. */
// CONTRACT: documents/contracts/helper.md#messages

import {
  PROTOCOL_VERSION,
  type HelperDirection, type HelperParseResult, type HelperRejection, type HelperRejectionKind,
  type ToHelperMessage, type ToPageMessage,
} from "./helperMessages.js";
import { isRecord } from "../guards/index.js";
import { FieldError } from "./messageFields.js";
import { readToHelper } from "./readToHelper.js";
import { readToPage } from "./readToPage.js";
import { formatError } from "../logging/index.js";

const MAX_ID_LENGTH = 64;

function reject(code: HelperRejectionKind, reason: string, id?: string): HelperRejection {
  return id === undefined ? { ok: false, code, reason } : { ok: false, code, reason, id };
}

export type MessageFor<D extends HelperDirection> = D extends "toHelper" ? ToHelperMessage : ToPageMessage;

export function parseHelperMessage<D extends HelperDirection>(raw: unknown, direction: D): HelperParseResult<MessageFor<D>> {
  if (!isRecord(raw)) { return reject("malformed", "frame is not a JSON object"); }
  const { id, v, type } = raw;
  // CONTRACT: documents/contracts/helper.md#messages — only an `error` reply may come without an id.
  const mayLackId = direction === "toPage" && type === "error";
  if (!(mayLackId && id === undefined) && (typeof id !== "string" || id === "" || id.length > MAX_ID_LENGTH)) {
    return reject("malformed", `id is not a string of 1 to ${MAX_ID_LENGTH} characters`);
  }
  const replyId = typeof id === "string" ? id : undefined;
  if (v !== PROTOCOL_VERSION) {
    const rejection = reject("version", `v is ${String(v)}, expected ${PROTOCOL_VERSION}`, replyId);
    return typeof v === "number" ? { ...rejection, received: v } : rejection;
  }
  if (typeof type !== "string") { return reject("malformed", "type is not a string", replyId); }
  try {
    const envelope = replyId === undefined ? { v } : { v, id: replyId };
    const message = direction === "toHelper" ? readToHelper(type, raw, envelope as { v: number; id: string }) : readToPage(type, raw, envelope);
    return message ? { ok: true, message: message as MessageFor<D> } : reject("unknown-type", `${type} is not a message sent ${direction === "toHelper" ? "to the helper" : "to the page"}`, replyId);
  } catch (error) {
    if (error instanceof FieldError) { return reject(error.code, `${type}: ${error.message}`, replyId); }
    // TRAP: only a parser bug lands here; it still becomes a rejection because callers rely on this never throwing.
    return reject("malformed", `${type}: ${formatError(error)}`, replyId);
  }
}
