/** Validates the body of a message an extension page sends to LabShelf Helper. */
// CONTRACT: documents/contracts/helper.md#page-to-helper

import {
  MAX_SYNC_TOTAL_BYTES, type SyncedFile, type ToHelperMessage,
} from "./helperMessages.js";
import { TEX_INSTALL_KINDS } from "../latex/index.js";
import { LATEX_ENGINES } from "../project/index.js";
import {
  FieldError, isBody, isNonNegativeInteger, readArray, readChoice, readChunk, readNumber, readPath, readPaths,
  readProjectId, readSha256, readText, type Body,
} from "./messageFields.js";

type Envelope = { v: number; id: string };
type Readers = { [T in ToHelperMessage["type"]]: (body: Body, envelope: Envelope) => Extract<ToHelperMessage, { type: T }> };

function readSyncedFiles(body: Body): SyncedFile[] {
  const files = readArray(body, "files").map((entry, index): SyncedFile => {
    if (!isBody(entry)) { throw new FieldError("invalid-field", `files[${index}] is not an object`); }
    return { path: readPath(entry, "path"), sha256: readSha256(entry, "sha256"), size: readNumber(entry, "size", isNonNegativeInteger) };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new FieldError("invalid-field", "files lists a path twice");
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_SYNC_TOTAL_BYTES) {
    throw new FieldError("limit", "files declare more than 500 MiB in total");
  }
  return files;
}

const READERS: Readers = {
  hello: (body, envelope) => ({ ...envelope, type: "hello", extensionVersion: readText(body, "extensionVersion") }),
  sync: (body, envelope) => ({ ...envelope, type: "sync", projectId: readProjectId(body), files: readSyncedFiles(body) }),
  file: (body, envelope) => ({
    ...envelope, type: "file", projectId: readProjectId(body), path: readPath(body, "path"), chunk: readChunk(body),
  }),
  delete: (body, envelope) => ({ ...envelope, type: "delete", projectId: readProjectId(body), paths: readPaths(body, "paths") }),
  build: (body, envelope) => ({
    ...envelope, type: "build", projectId: readProjectId(body), main: readPath(body, "main"),
    engine: readChoice(body, "engine", LATEX_ENGINES),
  }),
  cancel: (body, envelope) => ({ ...envelope, type: "cancel", projectId: readProjectId(body) }),
  installTex: (body, envelope) => ({ ...envelope, type: "installTex", kind: readChoice(body, "kind", TEX_INSTALL_KINDS) }),
  installAllPackages: (_body, envelope) => ({ ...envelope, type: "installAllPackages" }),
};

/** The validated message, or undefined when `type` is not one a page sends. */
export function readToHelper(type: string, body: Body, envelope: Envelope): ToHelperMessage | undefined {
  return Object.hasOwn(READERS, type) ? READERS[type as ToHelperMessage["type"]](body, envelope) : undefined;
}
