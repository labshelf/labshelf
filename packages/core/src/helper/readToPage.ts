/** Validates the body of a message LabShelf Helper sends to an extension page. */
// CONTRACT: documents/contracts/helper.md#messages

import type { BuildProblemKind, LocatedProblem } from "../latex/index.js";
import {
  HELPER_BUILD_STATUSES, HELPER_HOSTS, PROGRESS_PHASES, TEX_SOURCES,
  type ChangedPage, type TexToolchain, type ToPageMessage,
} from "./helperMessages.js";
import {
  FieldError, isBody, isNonNegativeInteger, isPositiveInteger, readArray, readBody, readBoolean, readChoice, readNumber, readPaths,
  readProjectId, readSha256, readString, readText, readOptionalField, type Body,
} from "./messageFields.js";

import { readTemplatePublishEvent } from "./template/index.js";

type Envelope = { v: number; id: string };
type Readers = { [T in ToPageMessage["type"]]: (body: Body, envelope: Envelope) => Extract<ToPageMessage, { type: T }> };

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
    if (!isBody(entry)) { throw new FieldError("invalid-field", `problems[${index}] is not an object`); }
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
    if (!isBody(entry)) { throw new FieldError("invalid-field", `changed[${index}] is not an object`); }
    return {
      index: readNumber(entry, "index", isNonNegativeInteger),
      offset: readNumber(entry, "offset", isNonNegativeInteger),
      length: readNumber(entry, "length", isNonNegativeInteger),
    };
  });
}

const READERS: Readers = {
  templatePreview: (_body, envelope) => ({ ...envelope, type: "templatePreview" }),
  templatePublish: (body, envelope) => ({ ...envelope, type: "templatePublish", done: readBoolean(body, "done"),
    ...(body.event === undefined ? {} : { event: readTemplatePublishEvent(body) }) }),
  ready: (body, envelope) => ({
    ...envelope, type: "ready", protocol: readNumber(body, "protocol", isPositiveInteger),
    helperVersion: readText(body, "helperVersion"), host: readChoice(body, "host", HELPER_HOSTS), tex: readTex(body),
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
  error: (body, envelope) => ({ ...envelope, type: "error", code: readText(body, "code"), message: readString(body, "message") }),
};

/** The validated message, or undefined when `type` is not one the helper sends. */
export function readToPage(type: string, body: Body, envelope: { v: number; id?: string }): ToPageMessage | undefined {
  // INVARIANT: the caller leaves `id` out only for `error`, whose reader does not require it.
  return Object.hasOwn(READERS, type) ? READERS[type as ToPageMessage["type"]](body, envelope as Envelope) : undefined;
}
