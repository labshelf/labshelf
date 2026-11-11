// Carries PaperObjectsPort calls across a message boundary (a webview, a page): one request/reply pair, bytes as base64,
// which each host protocol wraps the way it wraps the note file requests.
import { createReplyClient } from "../async/index.js";
import { bytesToBase64, decodeCheckedBase64 } from "../encoding/index.js";
import { formatError } from "../errors/index.js";
import { isNonEmptyString, isOneOf, isRecord, isString, isStringArray } from "../guards/index.js";
import { safeNotePath } from "../qmd/noteFiles.js";
import type {
  PageBox, PaperChoice, PaperObject, PaperObjectInsert, PaperObjectInsertOptions, PaperObjectKind, PaperObjectsPort, PaperObjectVia,
} from "./types.js";

/** One port call, without the identity a host protocol may add around it. */
export type PaperObjectsCall =
  | { op: "papers"; query: string }
  | { op: "list"; paperId: string }
  | { op: "preview"; paperId: string; object: PaperObject }
  | { op: "insert"; paperId: string; object: PaperObject; options: PaperObjectInsertOptions };

export interface PaperObjectsRequest { type: "paperObjects.request"; requestId: string; call: PaperObjectsCall }

/** What `insert` resolves to on the wire: the asset bytes as base64. */
export interface PaperObjectInsertWire { markdown: string; assets: { path: string; base64: string }[]; via: PaperObjectVia }

/** The result of the call by op: papers, objects, a preview PNG as base64 (null when it cannot be rendered) or an insert. */
export type PaperObjectsValue = PaperChoice[] | PaperObject[] | string | null | PaperObjectInsertWire;

/** The answer to one request with the same `requestId`: `value` on success, `error` (the rejection's message) on failure. */
export interface PaperObjectsReply { type: "paperObjects.reply"; requestId: string; value?: PaperObjectsValue; error?: string }

const KINDS: readonly PaperObjectKind[] = ["equation", "figure", "table"];
const VIAS: readonly PaperObjectVia[] = ["arxiv", "pdf-text", "pix2tex", "ai", "image"];

const isFraction = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function isPageBox(value: unknown): value is PageBox {
  return isRecord(value) && isFraction(value["x"]) && isFraction(value["y"]) && isFraction(value["w"]) && isFraction(value["h"]);
}

/** True for a well-formed PaperObject: a known kind, a label, a 1-based integer page, a box of page fractions and a caption. */
export function isPaperObject(value: unknown): value is PaperObject {
  return isRecord(value) && isOneOf(KINDS, value["kind"]) && isNonEmptyString(value["label"])
    && Number.isInteger(value["page"]) && (value["page"] as number) >= 1 && isPageBox(value["box"]) && isString(value["caption"]);
}

function isInsertOptions(value: unknown): value is PaperObjectInsertOptions {
  return isRecord(value) && isNonEmptyString(value["assetName"]) && isStringArray(value["takenLabels"])
    && (value["asImage"] === undefined || typeof value["asImage"] === "boolean");
}

function isPaperChoice(value: unknown): value is PaperChoice {
  return isRecord(value) && isNonEmptyString(value["id"]) && (value["citeKey"] === null || isString(value["citeKey"]))
    && isString(value["title"]) && isString(value["authors"]) && (value["year"] === null || isString(value["year"]));
}

/** Padded standard base64 checked with a flat character class, so a multi-megabyte image costs one pass and no deep regex. */
function isBase64(value: unknown): value is string {
  return isString(value) && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function isInsertWire(value: unknown): value is PaperObjectInsertWire {
  return isRecord(value) && isString(value["markdown"]) && isOneOf(VIAS, value["via"])
    && Array.isArray(value["assets"])
    && value["assets"].every((asset) => isRecord(asset) && isString(asset["path"]) && safeNotePath(asset["path"]) !== null && isBase64(asset["base64"]));
}

function isCall(value: unknown): value is PaperObjectsCall {
  if (!isRecord(value)) { return false; }
  switch (value["op"]) {
    case "papers": return isString(value["query"]);
    case "list": return isNonEmptyString(value["paperId"]);
    case "preview": return isNonEmptyString(value["paperId"]) && isPaperObject(value["object"]);
    case "insert": return isNonEmptyString(value["paperId"]) && isPaperObject(value["object"]) && isInsertOptions(value["options"]);
    default: return false;
  }
}

/** True for a well-formed request: a known op whose fields all have the port's shapes. */
export function isPaperObjectsRequest(value: unknown): value is PaperObjectsRequest {
  return isRecord(value) && value["type"] === "paperObjects.request" && isNonEmptyString(value["requestId"]) && isCall(value["call"]);
}

function isValue(value: unknown): value is PaperObjectsValue {
  if (value === null || isBase64(value) || isInsertWire(value)) { return true; }
  return Array.isArray(value) && (value.every(isPaperChoice) || value.every(isPaperObject));
}

/** True for a well-formed reply: an error string, or a value of one of the ops' result shapes. */
export function isPaperObjectsReply(value: unknown): value is PaperObjectsReply {
  if (!isRecord(value) || value["type"] !== "paperObjects.reply" || !isNonEmptyString(value["requestId"])) { return false; }
  if (value["error"] !== undefined) { return isString(value["error"]) && value["value"] === undefined; }
  return value["value"] === undefined || isValue(value["value"]);
}

const malformed = (): Error => new Error("Malformed paper objects reply");

function readPapers(value: PaperObjectsValue | undefined): PaperChoice[] {
  if (!Array.isArray(value) || !value.every(isPaperChoice)) { throw malformed(); }
  return value;
}

function readObjects(value: PaperObjectsValue | undefined): PaperObject[] {
  if (!Array.isArray(value) || !value.every(isPaperObject)) { throw malformed(); }
  return value;
}

function readPreview(value: PaperObjectsValue | undefined): Uint8Array | null {
  if (value === null) { return null; }
  if (!isBase64(value)) { throw malformed(); }
  return decodeCheckedBase64(value);
}

function readInsert(value: PaperObjectsValue | undefined): PaperObjectInsert {
  if (!isInsertWire(value)) { throw malformed(); }
  return { markdown: value.markdown, via: value.via, assets: value.assets.map((asset) => ({ path: asset.path, bytes: decodeCheckedBase64(asset.base64) })) };
}

/**
 * A port that posts each call as a PaperObjectsRequest and settles it on the reply with the same requestId; a reply's error
 * rejects with `new Error(error)`, so "This paper has no PDF." reaches the picker as is. `onReply` subscribes to the incoming
 * messages while a call is pending, like createNoteFilesClient.
 */
export function createPaperObjectsClient(post: (request: PaperObjectsRequest) => void, onReply: (listener: (message: unknown) => void) => () => void): PaperObjectsPort {
  const call = createReplyClient(post, onReply, isPaperObjectsReply);
  const request = <T>(op: PaperObjectsCall, read: (value: PaperObjectsValue | undefined) => T): Promise<T> =>
    call((requestId) => ({ type: "paperObjects.request", requestId, call: op }), (reply) => read(reply.value));

  return {
    papers: (query) => request({ op: "papers", query }, readPapers),
    list: (paperId) => request({ op: "list", paperId }, readObjects),
    preview: (paperId, object) => request({ op: "preview", paperId, object }, readPreview),
    insert: (paperId, object, options) => request({ op: "insert", paperId, object, options: { ...options, takenLabels: [...options.takenLabels] } }, readInsert),
  };
}

async function callPort(port: PaperObjectsPort, call: PaperObjectsCall): Promise<PaperObjectsValue> {
  switch (call.op) {
    case "papers": return port.papers(call.query);
    case "list": return port.list(call.paperId);
    case "preview": {
      const png = await port.preview(call.paperId, call.object);
      return png === null ? null : bytesToBase64(png);
    }
    case "insert": {
      const insert = await port.insert(call.paperId, call.object, call.options);
      return { markdown: insert.markdown, via: insert.via, assets: insert.assets.map((asset) => ({ path: asset.path, base64: bytesToBase64(asset.bytes) })) };
    }
  }
}

/** The reply to one request from `port`; never rejects, a failure is the reply's error (its message as is). */
export async function answerPaperObjectsRequest(port: PaperObjectsPort, request: PaperObjectsRequest): Promise<PaperObjectsReply> {
  const reply = { type: "paperObjects.reply" as const, requestId: request.requestId };
  try {
    return { ...reply, value: await callPort(port, request.call) };
  } catch (error) {
    return { ...reply, error: formatError(error) };
  }
}

/** The reply of a surface whose host has no paper-object port. */
export function unsupportedPaperObjectsReply(request: Pick<PaperObjectsRequest, "requestId">): PaperObjectsReply {
  return { type: "paperObjects.reply", requestId: request.requestId, error: "From paper is not available here." };
}
