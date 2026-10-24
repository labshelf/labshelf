/** Validates the body of a message an extension page sends to LabShelf Helper. */
// CONTRACT: documents/contracts/helper.md#page-to-helper

import { COMPILE_MODES, MAX_EDIT_CHANGES, type TextChange, type ToHelperMessage } from "./helperMessages.js";
import { TEX_INSTALL_KINDS } from "../../latex/index.js";
import { LATEX_ENGINES } from "../project/index.js";
import {
  FieldError, isBody, isNonNegativeInteger, isPositiveInteger, optional, readArray, readBoolean, readChoice, readNumber, readPath,
  readProjectId, readString, readText, type Body,
} from "./messageFields.js";

import { readTemplatePublishRequest } from "./publishing/index.js";

type Envelope = { v: number; id: string };
type Readers = { [T in ToHelperMessage["type"]]: (body: Body, envelope: Envelope) => Extract<ToHelperMessage, { type: T }> };

function readChanges(body: Body): TextChange[] {
  return readArray(body, "changes", MAX_EDIT_CHANGES).map((entry, index): TextChange => {
    if (!isBody(entry)) { throw new FieldError("invalid-field", `changes[${index}] is not an object`); }
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

const READERS: Readers = {
  templateThumbnail: (body, envelope) => ({ ...envelope, type: "templateThumbnail", requestId: readText(body, "requestId"), ...optional(body, "error", readString) }),
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
    ...optional(body, "engine", (b, k) => readChoice(b, k, LATEX_ENGINES)),
    ...optional(body, "editedFile", readPath),
    ...optional(body, "editedLine", (b, k) => readNumber(b, k, isPositiveInteger)),
    ...optional(body, "haltOnError", readBoolean),
  }),
  cancel: (body, envelope) => ({ ...envelope, type: "cancel", projectId: readProjectId(body) }),
  installTex: (body, envelope) => ({ ...envelope, type: "installTex", kind: readChoice(body, "kind", TEX_INSTALL_KINDS) }),
  installAllPackages: (_body, envelope) => ({ ...envelope, type: "installAllPackages" }),
};

/** The validated message, or undefined when `type` is not one a page sends. */
export function readToHelper(type: string, body: Body, envelope: Envelope): ToHelperMessage | undefined {
  return Object.hasOwn(READERS, type) ? READERS[type as ToHelperMessage["type"]](body, envelope) : undefined;
}
