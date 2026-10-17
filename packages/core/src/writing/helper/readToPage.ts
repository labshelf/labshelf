/** Validates the body of a message LabShelf Helper sends to an extension page. */
// CONTRACT: documents/contracts/helper.md#helper-to-page

import type { BuildProblemKind, LocatedProblem } from "../latex/index.js";
import {
  HELPER_BUILD_STATUSES, PROGRESS_PHASES, TEX_SOURCES,
  type TexStatus, type ToPageMessage,
} from "./helperMessages.js";
import {
  FieldError, isBody, readArray, readBody, readBoolean, readChoice, readChunk, readNumber, readPaths,
  readSha256, readString, readText, optional, type Body,
} from "./messageFields.js";

type Envelope = { v: number; id: string };
type Readers = { [T in ToPageMessage["type"]]: (body: Body, envelope: Envelope) => Extract<ToPageMessage, { type: T }> };

const SEVERITIES = ["error", "warning", "info"] as const;
const PROBLEM_KINDS: readonly BuildProblemKind[] = ["undefinedCitation", "undefinedReference", "overfull"];
const isPositiveInteger = (n: number): boolean => Number.isInteger(n) && n > 0;

function readTex(body: Body): TexStatus {
  const tex = readBody(body, "tex");
  return {
    source: readChoice(tex, "source", TEX_SOURCES),
    ...optional(tex, "year", (b, k) => readNumber(b, k, isPositiveInteger)),
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
      ...optional(entry, "hint", readString),
      ...optional(entry, "line", (b, k) => readNumber(b, k, isPositiveInteger)),
      ...optional(entry, "kind", (b, k) => readChoice(b, k, PROBLEM_KINDS)),
      ...optional(entry, "subject", readString),
    };
  });
}

const READERS: Readers = {
  ready: (body, envelope) => ({
    ...envelope, type: "ready", protocol: readNumber(body, "protocol", isPositiveInteger),
    helperVersion: readText(body, "helperVersion"), tex: readTex(body),
  }),
  need: (body, envelope) => ({ ...envelope, type: "need", paths: readPaths(body, "paths") }),
  progress: (body, envelope) => ({
    ...envelope, type: "progress", phase: readChoice(body, "phase", PROGRESS_PHASES), message: readString(body, "message"),
    ...optional(body, "fraction", (b, k) => readNumber(b, k, (n) => n >= 0 && n <= 1)),
  }),
  built: (body, envelope) => ({
    ...envelope, type: "built", status: readChoice(body, "status", HELPER_BUILD_STATUSES), problems: readProblems(body),
    ...optional(body, "pdfSha256", readSha256),
  }),
  pdf: (body, envelope) => ({ ...envelope, type: "pdf", chunk: readChunk(body) }),
  error: (body, envelope) => ({ ...envelope, type: "error", code: readText(body, "code"), message: readString(body, "message") }),
};

/** The validated message, or undefined when `type` is not one the helper sends. */
export function readToPage(type: string, body: Body, envelope: Envelope): ToPageMessage | undefined {
  return Object.hasOwn(READERS, type) ? READERS[type as ToPageMessage["type"]](body, envelope) : undefined;
}
