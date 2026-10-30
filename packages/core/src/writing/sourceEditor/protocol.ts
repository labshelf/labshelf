// Declares the source editor's webview protocol (both directions) and the parsers that reject any invalid message whole.
import { isBoolean, isNumber, isOneOf, isRecord, isString } from "../../guards/index.js";
import type { WrapKind } from "../snippets.js";
import type { SourceUpdate } from "./authority.js";

interface SourceProblem { line: number; severity: "error" | "warning" | "info"; message: string }
/** A thread's range in LF offsets of the document. */
interface SourceCommentRange { id: string; from: number; to: number }
interface SourcePeer { name: string; colour: string; anchor: number; head: number }

type SourceEditorCommand =
  | { kind: "insertText"; text: string }
  | { kind: "insertSnippet"; snippet: string }
  | { kind: "wrap"; style: WrapKind };

export type SourceEditorInbound =
  | { type: "init"; path: string; projectId: string; language: "latex" | "typst"; text: string; lineBreak: "\n" | "\r\n"; version: number; readOnly: boolean; dirty: boolean }
  | { type: "updates"; version: number; updates: SourceUpdate[] }
  | { type: "resync"; text: string; version: number }
  | { type: "dirty"; dirty: boolean }
  | { type: "reveal"; line: number }
  | { type: "problems"; problems: SourceProblem[] }
  | { type: "command"; command: SourceEditorCommand }
  | { type: "response"; id: number; ok: true; value: unknown } | { type: "response"; id: number; ok: false; error: string }
  | { type: "comments"; ranges: SourceCommentRange[] }
  | { type: "peers"; peers: SourcePeer[] };

type SourceEditorRequestMethod =
  | "papers" | "readNote" | "listProjectNotes" | "readProjectNote" | "listCitedPaperIds" | "readPaperNote"
  | "listFiles" | "readFile" | "openNotes" | "openFile" | "addComment" | "openComments";

export type SourceEditorOutbound =
  | { type: "ready" }
  | { type: "push"; version: number; updates: SourceUpdate[] }
  | { type: "save" }
  | { type: "selection"; anchor: number; head: number; line: number }
  | { type: "focus"; focused: boolean }
  | { type: "request"; id: number; method: SourceEditorRequestMethod; params: unknown };

const LANGUAGES = ["latex", "typst"] as const;
const LINE_BREAKS = ["\n", "\r\n"] as const;
const SEVERITIES = ["error", "warning", "info"] as const;
const WRAP_KINDS = ["bold", "italic"] as const satisfies readonly WrapKind[];

type Parse<T> = (value: unknown) => T | undefined;

function parseList<T>(value: unknown, parseItem: Parse<T>): T[] | undefined {
  if (!Array.isArray(value)) { return undefined; }
  const out: T[] = [];
  for (const item of value) {
    const parsed = parseItem(item);
    if (parsed === undefined) { return undefined; }
    out.push(parsed);
  }
  return out;
}

function parseChange(value: unknown): SourceUpdate["changes"][number] | undefined {
  if (!isRecord(value) || !isNumber(value.from) || !isNumber(value.to) || !isString(value.insert)) { return undefined; }
  return { from: value.from, to: value.to, insert: value.insert };
}

function parseUpdate(value: unknown): SourceUpdate | undefined {
  if (!isRecord(value) || !isString(value.clientID)) { return undefined; }
  const changes = parseList(value.changes, parseChange);
  return changes && { clientID: value.clientID, changes };
}

function parseProblem(value: unknown): SourceProblem | undefined {
  if (!isRecord(value) || !isNumber(value.line) || !isOneOf(SEVERITIES, value.severity) || !isString(value.message)) { return undefined; }
  return { line: value.line, severity: value.severity, message: value.message };
}

function parseCommentRange(value: unknown): SourceCommentRange | undefined {
  if (!isRecord(value) || !isString(value.id) || !isNumber(value.from) || !isNumber(value.to)) { return undefined; }
  return { id: value.id, from: value.from, to: value.to };
}

function parsePeer(value: unknown): SourcePeer | undefined {
  if (!isRecord(value) || !isString(value.name) || !isString(value.colour) || !isNumber(value.anchor) || !isNumber(value.head)) { return undefined; }
  return { name: value.name, colour: value.colour, anchor: value.anchor, head: value.head };
}

function parseCommand(value: unknown): SourceEditorCommand | undefined {
  if (!isRecord(value)) { return undefined; }
  if (value.kind === "insertText" && isString(value.text)) { return { kind: "insertText", text: value.text }; }
  if (value.kind === "insertSnippet" && isString(value.snippet)) { return { kind: "insertSnippet", snippet: value.snippet }; }
  if (value.kind === "wrap" && isOneOf(WRAP_KINDS, value.style)) { return { kind: "wrap", style: value.style }; }
  return undefined;
}

function parseInboundBody(value: Record<string, unknown>): SourceEditorInbound | undefined {
  switch (value.type) {
    case "init":
      if (!isString(value.path) || !isString(value.projectId) || !isOneOf(LANGUAGES, value.language) || !isString(value.text)
        || !isOneOf(LINE_BREAKS, value.lineBreak) || !isNumber(value.version) || !isBoolean(value.readOnly) || !isBoolean(value.dirty)) { return undefined; }
      return {
        type: "init", path: value.path, projectId: value.projectId, language: value.language, text: value.text,
        lineBreak: value.lineBreak, version: value.version, readOnly: value.readOnly, dirty: value.dirty,
      };
    case "updates": {
      const updates = parseList(value.updates, parseUpdate);
      return isNumber(value.version) && updates ? { type: "updates", version: value.version, updates } : undefined;
    }
    case "resync":
      return isString(value.text) && isNumber(value.version) ? { type: "resync", text: value.text, version: value.version } : undefined;
    case "dirty":
      return isBoolean(value.dirty) ? { type: "dirty", dirty: value.dirty } : undefined;
    case "reveal":
      return isNumber(value.line) ? { type: "reveal", line: value.line } : undefined;
    case "problems": {
      const problems = parseList(value.problems, parseProblem);
      return problems && { type: "problems", problems };
    }
    case "command": {
      const command = parseCommand(value.command);
      return command && { type: "command", command };
    }
    case "response":
      if (!isNumber(value.id)) { return undefined; }
      if (value.ok === true) { return { type: "response", id: value.id, ok: true, value: value.value }; }
      return value.ok === false && isString(value.error) ? { type: "response", id: value.id, ok: false, error: value.error } : undefined;
    case "comments": {
      const ranges = parseList(value.ranges, parseCommentRange);
      return ranges && { type: "comments", ranges };
    }
    case "peers": {
      const peers = parseList(value.peers, parsePeer);
      return peers && { type: "peers", peers };
    }
    default:
      return undefined;
  }
}

/** Params of each request method, validated and rebuilt so unknown keys never pass through. */
const PARAMS: Record<SourceEditorRequestMethod, Parse<Record<string, unknown>>> = {
  papers: (p) => isRecord(p) ? {} : undefined,
  readNote: (p) => isRecord(p) && isString(p.paperId) ? { paperId: p.paperId } : undefined,
  listProjectNotes: (p) => isRecord(p) ? {} : undefined,
  readProjectNote: (p) => isRecord(p) && isString(p.path) ? { path: p.path } : undefined,
  listCitedPaperIds: (p) => isRecord(p) ? {} : undefined,
  readPaperNote: (p) => isRecord(p) && isString(p.paperId) ? { paperId: p.paperId } : undefined,
  listFiles: (p) => isRecord(p) ? {} : undefined,
  readFile: (p) => isRecord(p) && isString(p.path) ? { path: p.path } : undefined,
  openNotes: (p) => isRecord(p) && isString(p.paperId) ? { paperId: p.paperId } : undefined,
  openFile: (p) => {
    if (!isRecord(p) || !isString(p.path)) { return undefined; }
    if (p.line === undefined) { return { path: p.path }; }
    return isNumber(p.line) ? { path: p.path, line: p.line } : undefined;
  },
  addComment: (p) => isRecord(p) && isNumber(p.from) && isNumber(p.to) && isString(p.text) ? { from: p.from, to: p.to, text: p.text } : undefined,
  openComments: (p) => {
    if (!isRecord(p)) { return undefined; }
    if (p.id === undefined) { return {}; }
    return isString(p.id) ? { id: p.id } : undefined;
  },
};

function parseOutboundBody(value: Record<string, unknown>): SourceEditorOutbound | undefined {
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "save":
      return { type: "save" };
    case "push": {
      const updates = parseList(value.updates, parseUpdate);
      return isNumber(value.version) && updates ? { type: "push", version: value.version, updates } : undefined;
    }
    case "selection":
      return isNumber(value.anchor) && isNumber(value.head) && isNumber(value.line)
        ? { type: "selection", anchor: value.anchor, head: value.head, line: value.line } : undefined;
    case "focus":
      return isBoolean(value.focused) ? { type: "focus", focused: value.focused } : undefined;
    case "request": {
      if (!isNumber(value.id) || !isString(value.method) || !Object.hasOwn(PARAMS, value.method)) { return undefined; }
      const method = value.method as SourceEditorRequestMethod;
      const params = PARAMS[method](value.params);
      return params && { type: "request", id: value.id, method, params };
    }
    default:
      return undefined;
  }
}

function parseWith<T>(value: unknown, parseBody: (value: Record<string, unknown>) => T | undefined): T | undefined {
  if (!isRecord(value) || Array.isArray(value)) { return undefined; }
  const parsed = parseBody(value);
  // Only the message type is logged, never a payload.
  if (parsed === undefined && isString(value.type)) { console.warn(`Rejected source editor message of type "${value.type}"`); }
  return parsed;
}

/** @returns the message as built from validated fields, or undefined when any part of it is invalid */
export function parseSourceEditorInbound(value: unknown): SourceEditorInbound | undefined {
  return parseWith(value, parseInboundBody);
}

/** @returns the message as built from validated fields, or undefined when any part of it is invalid */
export function parseSourceEditorOutbound(value: unknown): SourceEditorOutbound | undefined {
  return parseWith(value, parseOutboundBody);
}
