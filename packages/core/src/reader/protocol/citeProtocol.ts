// The reader's cite popup messages: the `cite.reply` message and the guards that validate a cite request and its reply.
import { isNonEmptyString, isOneOf, isRecord, isString } from "../../guards/index.js";
import type { CiteProject, CiteReply, CiteRequest } from "../../writing/citations/index.js";
import { PROJECT_FORMATS } from "../../writing/project/index.js";

/** The host's answer to a `cite` request of the reader's cite popup. */
export interface CiteReplyMessage { type: "cite.reply"; requestId: string; reply: CiteReply }

/** The longest passage a `cite` insert may carry. */
export const MAX_CITE_QUOTE_LENGTH = 2000;

/** A whole number of at least 1. */
function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 1;
}

/** A relative '/' path with no empty, '.' or '..' segment, backslash or drive letter. */
function isRelativeProjectPath(value: unknown): boolean {
  if (!isNonEmptyString(value) || value.includes("\\") || /^[A-Za-z]:/.test(value)) { return false; }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** True for a well-formed cite popup request (plan reader-cite-popup D1). */
export function isCiteRequest(raw: unknown): raw is CiteRequest {
  if (!isRecord(raw)) { return false; }
  switch (raw["kind"]) {
    case "targets":
      return true;
    case "read":
      return isNonEmptyString(raw["projectId"]) && isRelativeProjectPath(raw["path"]);
    case "insert": {
      const { offset, page, quote } = raw;
      return isNonEmptyString(raw["projectId"]) && isRelativeProjectPath(raw["path"]) && isNonEmptyString(raw["version"])
        && Number.isInteger(offset) && (offset as number) >= 0
        && (page === undefined || isPositiveInteger(page))
        && (quote === undefined || (isString(quote) && quote.length <= MAX_CITE_QUOTE_LENGTH))
        && typeof raw["quoted"] === "boolean";
    }
    case "bibliography":
      return isNonEmptyString(raw["projectId"]);
    default:
      return false;
  }
}

function isCiteProject(raw: unknown): raw is CiteProject {
  return isRecord(raw) && isNonEmptyString(raw["id"]) && isString(raw["title"])
    && isOneOf(PROJECT_FORMATS, raw["format"])
    && isNonEmptyString(raw["bibliography"]) && typeof raw["inBibliography"] === "boolean"
    && Array.isArray(raw["files"]) && raw["files"].every(isRelativeProjectPath);
}

function isCiteReply(raw: unknown): raw is CiteReply {
  if (!isRecord(raw)) { return false; }
  switch (raw["kind"]) {
    case "targets":
      return Array.isArray(raw["projects"]) && raw["projects"].every(isCiteProject);
    case "source":
      return isString(raw["text"]) && isNonEmptyString(raw["version"]) && (raw["insert"] === undefined || isString(raw["insert"]));
    case "inserted":
      return isRelativeProjectPath(raw["path"]) && isString(raw["citation"]) && (raw["hint"] === undefined || isString(raw["hint"]));
    case "listed":
      return isNonEmptyString(raw["bibliography"]);
    case "error":
      return isString(raw["message"]) && (raw["stale"] === undefined || raw["stale"] === true);
    default:
      return false;
  }
}

/** True for a well-formed `cite.reply` message, so the popup settles a request only with a reply it can read. */
export function isCiteReplyMessage(raw: unknown): raw is CiteReplyMessage {
  return isRecord(raw) && raw["type"] === "cite.reply" && isNonEmptyString(raw["requestId"]) && isCiteReply(raw["reply"]);
}
