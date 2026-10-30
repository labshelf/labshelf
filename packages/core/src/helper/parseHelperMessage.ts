/** Turns an untrusted frame into a typed helper protocol message or a typed rejection, without throwing: field readers, then each direction's message readers, then the envelope check. */
// CONTRACT: documents/contracts/helper.md#messages

import { formatError } from "../errors/index.js";
import { isRecord } from "../guards/index.js";
import { CELL_LANGUAGES } from "../qmd/compute/index.js";
import { TEX_INSTALL_KINDS, type BuildProblemKind, type LocatedProblem } from "../latex/index.js";
import { TEMPLATE_CATEGORIES } from "../templates/templateManifest/index.js";
import { PUBLISH_CHECK_IDS } from "../templates/index.js";
import { LATEX_ENGINES } from "../writing/project/index.js";
import {
  CELL_STATUSES, COMPILE_MODES, HELPER_BUILD_STATUSES, HELPER_HOSTS, MAX_CELL_CODE_BYTES, MAX_CELL_TIMEOUT_MS, MAX_EDIT_CHANGES, MAX_NOTE_KEY_LENGTH, MAX_PROJECT_FILES, PROGRESS_PHASES, PROTOCOL_VERSION, PYTHON_STATES, TEX_SOURCES,
  type ChangedPage, type HelperDirection, type HelperParseResult, type HelperRejection, type HelperRejectionKind,
  type TemplatePublishEvent, type TemplatePublishRequest, type TexToolchain, type TextChange, type ToHelperMessage, type ToPageMessage,
} from "./helperMessages.js";
import { checkHelperPath, isHelperProjectId } from "./helperPaths.js";

// Field readers: read typed fields from an untrusted message body, throwing a FieldError that names the refused field.

type Body = Record<string, unknown>;

/** Thrown only inside the parser, which turns it into a HelperRejection. */
class FieldError extends Error {
  constructor(readonly code: HelperRejectionKind, message: string) {
    super(message);
  }
}

function readBody(body: Body, key: string): Body {
  const value = body[key];
  if (!isRecord(value)) { throw new FieldError("invalid-field", `${key} is not an object`); }
  return value;
}

function readString(body: Body, key: string): string {
  const value = body[key];
  if (typeof value !== "string") { throw new FieldError("invalid-field", `${key} is not a string`); }
  return value;
}

function readText(body: Body, key: string): string {
  const value = readString(body, key);
  if (value === "") { throw new FieldError("invalid-field", `${key} is empty`); }
  return value;
}

function readBoolean(body: Body, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") { throw new FieldError("invalid-field", `${key} is not a boolean`); }
  return value;
}

function readNumber(body: Body, key: string, isValid: (n: number) => boolean): number {
  const value = body[key];
  if (typeof value !== "number" || !isValid(value)) { throw new FieldError("invalid-field", `${key} is not a valid number`); }
  return value;
}

function readChoice<T extends string>(body: Body, key: string, choices: readonly T[]): T {
  const value = body[key];
  if (!choices.includes(value as T)) { throw new FieldError("invalid-field", `${key} is not one of ${choices.join(", ")}`); }
  return value as T;
}

/** Copies `key` through `read` only when the body has it, so absent optionals stay absent. */
function readOptionalField<T>(body: Body, key: string, read: (body: Body, key: string) => T): { [k: string]: T } {
  return body[key] === undefined ? {} : { [key]: read(body, key) };
}

function readArray(body: Body, key: string, max = MAX_PROJECT_FILES): unknown[] {
  const value = body[key];
  if (!Array.isArray(value)) { throw new FieldError("invalid-field", `${key} is not an array`); }
  if (value.length > max) { throw new FieldError("limit", `${key} has more than ${max} entries`); }
  return value;
}

function toPath(value: unknown, label: string): string {
  if (typeof value !== "string") { throw new FieldError("invalid-field", `${label} is not a string`); }
  const problem = checkHelperPath(value);
  if (problem) { throw new FieldError("path", `${label}: ${problem}`); }
  return value;
}

function readPath(body: Body, key: string): string {
  return toPath(body[key], key);
}

function readPaths(body: Body, key: string): string[] {
  return readArray(body, key).map((value, index) => toPath(value, `${key}[${index}]`));
}

function readProjectId(body: Body): string {
  const id = readString(body, "projectId");
  if (!isHelperProjectId(id)) { throw new FieldError("project-id", "projectId does not follow the project id rule"); }
  return id;
}

const isNonNegativeInteger = (n: number): boolean => Number.isInteger(n) && n >= 0;
const isPositiveInteger = (n: number): boolean => Number.isInteger(n) && n > 0;
const isSha256 = (text: string): boolean => /^[0-9a-f]{64}$/.test(text);

const MAX_CELL_SCOPE_LENGTH = 128;
const PAPER_SCOPE = "paper:";

/** A cell's cwd names a project id or `paper:<paperId>`, never a path; the helper resolves it from what it knows. */
function isCellScope(scope: string): boolean {
  if (isHelperProjectId(scope)) { return true; }
  if (!scope.startsWith(PAPER_SCOPE) || scope.length > MAX_CELL_SCOPE_LENGTH) { return false; }
  const paperId = scope.slice(PAPER_SCOPE.length);
  return paperId !== "" && paperId !== ".." && !/[\\/\u0000]/.test(paperId) && !paperId.startsWith("~");
}

function readCellScope(body: Body, key: string): string {
  const scope = readString(body, key);
  if (!isCellScope(scope)) { throw new FieldError("project-id", `${key} is neither a project id nor paper:<paperId>`); }
  return scope;
}

function readCellCode(body: Body, key: string): string {
  const code = readString(body, key);
  // The UTF-8 size is at least the length and at most three times it, so only the middle band needs the encoder.
  const tooLarge = code.length > MAX_CELL_CODE_BYTES || (code.length * 3 > MAX_CELL_CODE_BYTES && new TextEncoder().encode(code).length > MAX_CELL_CODE_BYTES);
  if (tooLarge) { throw new FieldError("limit", `${key} is larger than ${MAX_CELL_CODE_BYTES} bytes`); }
  return code;
}

function readNoteKey(body: Body, key: string): string {
  const value = readText(body, key);
  if (value.length > MAX_NOTE_KEY_LENGTH) { throw new FieldError("invalid-field", `${key} is longer than ${MAX_NOTE_KEY_LENGTH} characters`); }
  return value;
}

function readSha256(body: Body, key: string): string {
  const value = readString(body, key);
  if (!isSha256(value)) { throw new FieldError("invalid-field", `${key} is not a lowercase hex SHA-256`); }
  return value;
}

// Template publication fields crossing the helper socket.

function boundedText(body: Body, key: string): string {
  const value = readString(body, key);
  if (value.length > 20_000) throw new FieldError("limit", `${key} exceeds 20000 characters`);
  return value;
}

function readTemplatePublishRequest(body: Body): TemplatePublishRequest {
  const action = readChoice(body, "action", ["open", "check", "submit"]);
  if (action === "open") return { action };
  const raw = readBody(body, "draft");
  const draft = {
    name: boundedText(raw, "name"), category: readChoice(raw, "category", TEMPLATE_CATEGORIES),
    license: boundedText(raw, "license"), description: boundedText(raw, "description"),
  };
  if (action === "check") return { action, draft };
  const token = boundedText(body, "token");
  if (!token.trim()) throw new FieldError("invalid-field", "token is empty");
  return { action, draft, token };
}

function readTemplatePublishEvent(body: Body): TemplatePublishEvent {
  const event = readBody(body, "event");
  switch (event.type) {
    case "notice": return { type: "notice", kind: readChoice(event, "kind", ["info", "error"]), text: readString(event, "text") };
    case "publish.open": {
      const p = readBody(event, "project");
      const d = readBody(event, "draft");
      return { type: "publish.open", project: { id: readProjectId({ projectId: p.id }), title: readString(p, "title"), engineLabel: readText(p, "engineLabel") },
        draft: { name: readString(d, "name"), category: readChoice(d, "category", TEMPLATE_CATEGORIES), license: readString(d, "license"), description: readString(d, "description") } };
    }
    case "publish.checks": return {
      type: "publish.checks", running: readBoolean(event, "running"), ...readOptionalField(event, "thumbnail", readString),
      checks: readArray(event, "checks", PUBLISH_CHECK_IDS.length).map((c) => {
        if (!isRecord(c)) throw new FieldError("invalid-field", "check is not an object");
        return { id: readChoice(c, "id", PUBLISH_CHECK_IDS), ...readOptionalField(c, "ok", readBoolean), ...readOptionalField(c, "message", readString) };
      }),
    };
    case "publish.auth": return { type: "publish.auth", ...readOptionalField(event, "login", readText), ...readOptionalField(event, "error", readString) };
    case "publish.failed": return { type: "publish.failed", error: readString(event, "error") };
    case "publish.submitted": return { type: "publish.submitted", url: readText(event, "url") };
    default: throw new FieldError("invalid-field", "unknown template publication event");
  }
}

// Messages an extension page sends to LabShelf Helper.

type Envelope = { v: number; id: string };
type ToHelperReaders = { [T in ToHelperMessage["type"]]: (body: Body, envelope: Envelope) => Extract<ToHelperMessage, { type: T }> };

function readChanges(body: Body): TextChange[] {
  return readArray(body, "changes", MAX_EDIT_CHANGES).map((entry, index): TextChange => {
    if (!isRecord(entry)) { throw new FieldError("invalid-field", `changes[${index}] is not an object`); }
    const from = readNumber(entry, "from", isNonNegativeInteger);
    const to = readNumber(entry, "to", isNonNegativeInteger);
    if (to < from) { throw new FieldError("invalid-field", `changes[${index}] ends before it starts`); }
    return { from, to, insert: readString(entry, "insert") };
  });
}

function readEdit(body: Body, envelope: Envelope): Extract<ToHelperMessage, { type: "edit" }> {
  const base = {
    ...envelope, type: "edit" as const, projectId: readProjectId(body), path: readPath(body, "path"),
    version: readNumber(body, "version", (n) => Number.isInteger(n) && n >= 1),
  };
  if ((body.text === undefined) === (body.changes === undefined)) {
    throw new FieldError("invalid-field", "edit needs exactly one of text and changes");
  }
  return body.text !== undefined ? { ...base, text: readString(body, "text") } : { ...base, changes: readChanges(body) };
}

const TO_HELPER_READERS: ToHelperReaders = {
  templateThumbnail: (body, envelope) => ({ ...envelope, type: "templateThumbnail", requestId: readText(body, "requestId"), ...readOptionalField(body, "error", readString) }),
  publishTemplate: (body, envelope) => ({ ...envelope, type: "publishTemplate", projectId: readProjectId(body), ...readTemplatePublishRequest(body) }),
  hello: (body, envelope) => ({
    ...envelope, type: "hello", extensionVersion: readText(body, "extensionVersion"), origin: readText(body, "origin"),
  }),
  auth: (body, envelope) => ({ ...envelope, type: "auth", token: readText(body, "token") }),
  openProject: (body, envelope) => ({
    ...envelope, type: "openProject", projectId: readProjectId(body), root: readPath(body, "root"),
  }),
  closeProject: (body, envelope) => ({ ...envelope, type: "closeProject", projectId: readProjectId(body) }),
  edit: readEdit,
  save: (body, envelope) => ({ ...envelope, type: "save", projectId: readProjectId(body), path: readPath(body, "path") }),
  compile: (body, envelope) => ({
    ...envelope, type: "compile", projectId: readProjectId(body), main: readPath(body, "main"),
    mode: readChoice(body, "mode", COMPILE_MODES),
    ...readOptionalField(body, "engine", (b, k) => readChoice(b, k, LATEX_ENGINES)),
    ...readOptionalField(body, "editedFile", readPath),
    ...readOptionalField(body, "editedLine", (b, k) => readNumber(b, k, isPositiveInteger)),
    ...readOptionalField(body, "haltOnError", readBoolean),
  }),
  cancel: (body, envelope) => ({ ...envelope, type: "cancel", projectId: readProjectId(body) }),
  installTex: (body, envelope) => ({ ...envelope, type: "installTex", kind: readChoice(body, "kind", TEX_INSTALL_KINDS) }),
  installAllPackages: (_body, envelope) => ({ ...envelope, type: "installAllPackages" }),
  installPython: (_body, envelope) => ({ ...envelope, type: "installPython" }),
  runCell: (body, envelope) => ({
    ...envelope, type: "runCell", code: readCellCode(body, "code"), cwd: readCellScope(body, "cwd"),
    timeoutMs: readNumber(body, "timeoutMs", (n) => Number.isInteger(n) && n >= 1 && n <= MAX_CELL_TIMEOUT_MS),
    language: readChoice(body, "language", CELL_LANGUAGES), noteKey: readNoteKey(body, "noteKey"),
  }),
  cancelCell: (body, envelope) => ({ ...envelope, type: "cancelCell", requestId: readText(body, "requestId") }),
  restartCell: (body, envelope) => ({ ...envelope, type: "restartCell", noteKey: readNoteKey(body, "noteKey"), language: readChoice(body, "language", CELL_LANGUAGES) }),
};

/** The validated message, or undefined when `type` is not one a page sends. */
function readToHelper(type: string, body: Body, envelope: Envelope): ToHelperMessage | undefined {
  return Object.hasOwn(TO_HELPER_READERS, type) ? TO_HELPER_READERS[type as ToHelperMessage["type"]](body, envelope) : undefined;
}

// Messages LabShelf Helper sends to an extension page.

type ToPageReaders = { [T in ToPageMessage["type"]]: (body: Body, envelope: Envelope) => Extract<ToPageMessage, { type: T }> };

const SEVERITIES = ["error", "warning", "info"] as const;
const PROBLEM_KINDS: readonly BuildProblemKind[] = ["undefinedCitation", "undefinedReference", "overfull"];

function readTex(body: Body): TexToolchain {
  const tex = readBody(body, "tex");
  return {
    source: readChoice(tex, "source", TEX_SOURCES),
    ...readOptionalField(tex, "year", (b, k) => readNumber(b, k, isPositiveInteger)),
    complete: readBoolean(tex, "complete"),
  };
}

function readProblems(body: Body): LocatedProblem[] {
  return readArray(body, "problems").map((entry, index): LocatedProblem => {
    if (!isRecord(entry)) { throw new FieldError("invalid-field", `problems[${index}] is not an object`); }
    return {
      severity: readChoice(entry, "severity", SEVERITIES),
      message: readString(entry, "message"),
      file: readString(entry, "file"),
      ...readOptionalField(entry, "hint", readString),
      ...readOptionalField(entry, "line", (b, k) => readNumber(b, k, isPositiveInteger)),
      ...readOptionalField(entry, "kind", (b, k) => readChoice(b, k, PROBLEM_KINDS)),
      ...readOptionalField(entry, "subject", readString),
    };
  });
}

function readChangedPages(body: Body): ChangedPage[] {
  return readArray(body, "changed").map((entry, index): ChangedPage => {
    if (!isRecord(entry)) { throw new FieldError("invalid-field", `changed[${index}] is not an object`); }
    return {
      index: readNumber(entry, "index", isNonNegativeInteger),
      offset: readNumber(entry, "offset", isNonNegativeInteger),
      length: readNumber(entry, "length", isNonNegativeInteger),
    };
  });
}

const TO_PAGE_READERS: ToPageReaders = {
  templatePreview: (_body, envelope) => ({ ...envelope, type: "templatePreview" }),
  templatePublish: (body, envelope) => ({ ...envelope, type: "templatePublish", done: readBoolean(body, "done"),
    ...(body.event === undefined ? {} : { event: readTemplatePublishEvent(body) }) }),
  ready: (body, envelope) => ({
    ...envelope, type: "ready", protocol: readNumber(body, "protocol", isPositiveInteger),
    helperVersion: readText(body, "helperVersion"), host: readChoice(body, "host", HELPER_HOSTS), tex: readTex(body),
    ...readOptionalField(body, "python", (b, k) => readChoice(b, k, PYTHON_STATES)),
  }),
  session: (body, envelope) => ({
    ...envelope, type: "session", port: readNumber(body, "port", (n) => Number.isInteger(n) && n >= 1 && n <= 65535),
    token: readText(body, "token"),
  }),
  authed: (_body, envelope) => ({ ...envelope, type: "authed" }),
  opened: (body, envelope) => ({ ...envelope, type: "opened", projectId: readProjectId(body), files: readPaths(body, "files") }),
  closed: (body, envelope) => ({ ...envelope, type: "closed", projectId: readProjectId(body) }),
  progress: (body, envelope) => ({
    ...envelope, type: "progress", phase: readChoice(body, "phase", PROGRESS_PHASES), message: readString(body, "message"),
    ...readOptionalField(body, "fraction", (b, k) => readNumber(b, k, (n) => n >= 0 && n <= 1)),
  }),
  built: (body, envelope) => ({
    ...envelope, type: "built", status: readChoice(body, "status", HELPER_BUILD_STATUSES), problems: readProblems(body),
    ...readOptionalField(body, "pdfSha256", readSha256),
  }),
  pages: (body, envelope) => ({
    ...envelope, type: "pages", pdfSha256: readSha256(body, "pdfSha256"),
    pageCount: readNumber(body, "pageCount", isNonNegativeInteger), changed: readChangedPages(body),
  }),
  cellResult: (body, envelope) => ({
    ...envelope, type: "cellResult", status: readChoice(body, "status", CELL_STATUSES), language: readChoice(body, "language", CELL_LANGUAGES), durationMs: readNumber(body, "durationMs", (n) => n >= 0),
    ...readOptionalField(body, "restarted", readBoolean),
    ...readOptionalField(body, "latex", readString), ...readOptionalField(body, "text", readString), ...readOptionalField(body, "error", readString),
  }),
  error: (body, envelope) => ({ ...envelope, type: "error", code: readText(body, "code"), message: readString(body, "message") }),
};

/** The validated message, or undefined when `type` is not one the helper sends. */
function readToPage(type: string, body: Body, envelope: { v: number; id?: string }): ToPageMessage | undefined {
  // INVARIANT: the caller leaves `id` out only for `error`, whose reader does not require it.
  return Object.hasOwn(TO_PAGE_READERS, type) ? TO_PAGE_READERS[type as ToPageMessage["type"]](body, envelope as Envelope) : undefined;
}

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
