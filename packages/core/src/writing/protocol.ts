// Declares the source editor's webview protocol (both directions) and the parsers that reject any invalid message whole.
import { isBoolean, isNumber, isOneOf, isRecord, isString } from "../guards/index.js";
import type { WrapKind } from "./snippets.js";
import type { SourceUpdate } from "./authority.js";
import type { FileSuggestion, ReviewMode } from "../collab/index.js";
import { parseTypingHelpers, type TypingHelpers } from "./typing/helpers.js";
import { parseSelectionPopupMessage, type SelectionPopupPrefs } from "./selectionPopup/prefs.js";
import { OUTPUT_REQUEST_PARAMS, type OutputRequestMethod } from "./outputRequests.js";
import { formatCitationScopes, parseCitationScopes, type CitationScopeRecord } from "./citations/citationScopes.js";

interface SourceProblem { line: number; severity: "error" | "warning" | "info"; message: string }
interface SourceComment { author: string; body: string; createdAt: string }
/** A thread's range in LF offsets of the document, with its comments for the editor's popover. */
interface SourceCommentRange { id: string; from: number; to: number; comments: SourceComment[] }
interface SourcePeer { name: string; colour: string; anchor: number; head: number }

type SourceEditorCommand =
  | { kind: "insertText"; text: string }
  | { kind: "insertSnippet"; snippet: string }
  | { kind: "wrap"; style: WrapKind }
  // Cite from Library, run by the host's command: the page opens its popup.
  | { kind: "citeFromLibrary" }
  // Link Output…, run by the host's command: the page opens its own dialog.
  | { kind: "linkOutput" };

export type SourceEditorInbound =
  | { type: "init"; path: string; projectId: string; language: "latex" | "typst"; text: string; lineBreak: "\n" | "\r\n"; version: number; readOnly: boolean; dirty: boolean; review?: { mode: ReviewMode; author: string }; mathPreview?: boolean; spelling?: boolean; typing?: TypingHelpers; selectionPopup?: SelectionPopupPrefs }
  | { type: "updates"; version: number; updates: SourceUpdate[] }
  | { type: "resync"; text: string; version: number }
  | { type: "dirty"; dirty: boolean }
  | { type: "reveal"; line: number }
  | { type: "problems"; problems: SourceProblem[] }
  | { type: "command"; command: SourceEditorCommand }
  | { type: "response"; id: number; ok: true; value: unknown } | { type: "response"; id: number; ok: false; error: string }
  | { type: "comments"; ranges: SourceCommentRange[] }
  | { type: "peers"; peers: SourcePeer[] }
  | { type: "suggestions"; suggestions: FileSuggestion[] }
  // A code file of the project was saved or changed on disk: the editor reads the listings' files again.
  | { type: "codeChanged" }
  // A linked source folder, a copy under outputs/ or .labshelf/outputs.json changed: the editor resolves its output references again.
  | { type: "outputsChanged" }
  // The typing helpers changed in editor-prefs.json (here or in the other app): every open editor applies them.
  | { type: "typing"; typing: TypingHelpers }
  // The selection popup's settings changed in editor-prefs.json: every open editor applies them.
  | { type: "selectionPopup"; selectionPopup: SelectionPopupPrefs };

type SourceEditorRequestMethod =
  | "papers" | "readNote" | "listProjectNotes" | "readProjectNote" | "listCitedPaperIds" | "readPaperNote"
  | "listFiles" | "readFile" | "writeFile" | "openNotes" | "highlightsOf" | "openPaper" | "openFile" | "addComment" | "openComments" | "runAction"
  // Turns the LaTeX math preview off in the host's setting.
  | "disableMathPreview"
  // Insert code and the listings' marks: the project's code files and one file's text (null when it does not exist); Open source opens one at a 1-based line;
  // browseCodeFile lets the user pick any code file on the machine and answers its path relative to the project folder (null when cancelled or refused).
  | "listCodeFiles" | "readCodeFile" | "openCodeFile" | "browseCodeFile"
  // Spelling and simple-rule proofing: the machine-local dictionaries, the user's own words, turning proofing off in the host's setting,
  // and setSpelling ({ on }), the toolbar's switch, which stores either state without a message.
  | "dictionaryList" | "dictionaryRead" | "dictionaryInstall" | "userWords" | "addUserWord" | "disableSpelling" | "setSpelling"
  // setTyping ({ typing }): the typing helpers' switches, stored in the library's editor-prefs.json for both apps.
  | "setTyping"
  // setSelectionPopup ({ selectionPopup }): the selection popup's settings, stored in the library's editor-prefs.json for both apps.
  | "setSelectionPopup"
  // Cite from Library and the cite hover: the pdf.js assets (the talk and poster workspace's too), a paper's PDF as base64,
  // saving a citation's scope ({ record }; the host then brings the paper into the bibliography) and the scope records of a project file.
  | "pdfAssets" | "paperPdf" | "saveCitationScope" | "citationScopes"
  // The talk and poster workspace: the built PDF, a build, an image pick, Export PDF and the problems list.
  | "deckPdf" | "deckBuild" | "deckPickImage" | "deckDropImage" | "deckExportPdf" | "deckStylePreview" | "showProblems"
  // The library's deck Kits: list, save (a kit with an optional logo as base64) and an image pick that gives bytes.
  | "deckKits" | "deckSaveKit" | "deckPickKitImage"
  | OutputRequestMethod;

/** The project actions of the editor's toolbar, each run by the host as the command of the same name. */
export const SOURCE_EDITOR_ACTIONS = ["insertSymbol", "insertTable", "insertImage", "searchInProject", "showHistory", "shareProject", "toggleProjectChat", "showPreview", "togglePreview", "presentDeck", "posterPreview", "showInPreview"] as const;
export type SourceEditorAction = typeof SOURCE_EDITOR_ACTIONS[number];

export type SourceEditorOutbound =
  | { type: "ready" }
  | { type: "push"; version: number; updates: SourceUpdate[] }
  | { type: "save" }
  | { type: "selection"; anchor: number; head: number; line: number }
  | { type: "focus"; focused: boolean }
  | { type: "addSuggestions"; suggestions: FileSuggestion[] }
  | { type: "removeSuggestions"; ids: string[] }
  | { type: "reviewMode"; mode: ReviewMode }
  | { type: "request"; id: number; method: SourceEditorRequestMethod; params: unknown };

const LANGUAGES = ["latex", "typst"] as const;
const LINE_BREAKS = ["\n", "\r\n"] as const;
const SEVERITIES = ["error", "warning", "info"] as const;
const WRAP_KINDS = ["bold", "italic"] as const satisfies readonly WrapKind[];
const REVIEW_MODES = ["editing", "reviewing"] as const satisfies readonly ReviewMode[];
const SUGGESTION_KINDS = ["insert", "delete"] as const;

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

function parseComment(value: unknown): SourceComment | undefined {
  if (!isRecord(value) || !isString(value.author) || !isString(value.body) || !isString(value.createdAt)) { return undefined; }
  return { author: value.author, body: value.body, createdAt: value.createdAt };
}

/** A range without `comments` (an older host) still reads, with none; invalid comments make the range invalid. */
function parseCommentRange(value: unknown): SourceCommentRange | undefined {
  if (!isRecord(value) || !isString(value.id) || !isNumber(value.from) || !isNumber(value.to)) { return undefined; }
  const comments = value.comments === undefined ? [] : parseList(value.comments, parseComment);
  return comments && { id: value.id, from: value.from, to: value.to, comments };
}

function parsePeer(value: unknown): SourcePeer | undefined {
  if (!isRecord(value) || !isString(value.name) || !isString(value.colour) || !isNumber(value.anchor) || !isNumber(value.head)) { return undefined; }
  return { name: value.name, colour: value.colour, anchor: value.anchor, head: value.head };
}

function parseSuggestion(value: unknown): FileSuggestion | undefined {
  if (!isRecord(value) || !isString(value.id) || !isOneOf(SUGGESTION_KINDS, value.kind) || !isNumber(value.start) || !isNumber(value.end)
    || !isString(value.author) || !isString(value.created)) { return undefined; }
  if ((value.text !== undefined && !isString(value.text)) || (value.group !== undefined && !isString(value.group))) { return undefined; }
  const suggestion: FileSuggestion = { id: value.id, kind: value.kind, start: value.start, end: value.end, author: value.author, created: value.created };
  if (value.text !== undefined) { suggestion.text = value.text; }
  if (value.group !== undefined) { suggestion.group = value.group; }
  return suggestion;
}

/** @returns the well-formed suggestions of the list, dropping the malformed ones; undefined when the value is not a list */
function parseSuggestions(value: unknown): FileSuggestion[] | undefined {
  if (!Array.isArray(value)) { return undefined; }
  const out: FileSuggestion[] = [];
  for (const item of value) {
    const parsed = parseSuggestion(item);
    if (parsed) { out.push(parsed); }
  }
  return out;
}

function parseReview(value: unknown): { mode: ReviewMode; author: string } | undefined {
  return isRecord(value) && isOneOf(REVIEW_MODES, value.mode) && isString(value.author) ? { mode: value.mode, author: value.author } : undefined;
}

function parseCommand(value: unknown): SourceEditorCommand | undefined {
  if (!isRecord(value)) { return undefined; }
  if (value.kind === "insertText" && isString(value.text)) { return { kind: "insertText", text: value.text }; }
  if (value.kind === "insertSnippet" && isString(value.snippet)) { return { kind: "insertSnippet", snippet: value.snippet }; }
  if (value.kind === "wrap" && isOneOf(WRAP_KINDS, value.style)) { return { kind: "wrap", style: value.style }; }
  if (value.kind === "citeFromLibrary") { return { kind: "citeFromLibrary" }; }
  if (value.kind === "linkOutput") { return { kind: "linkOutput" }; }
  return undefined;
}

function parseInit(value: Record<string, unknown>): SourceEditorInbound | undefined {
  if (!isString(value.path) || !isString(value.projectId) || !isOneOf(LANGUAGES, value.language) || !isString(value.text)
    || !isOneOf(LINE_BREAKS, value.lineBreak) || !isNumber(value.version) || !isBoolean(value.readOnly) || !isBoolean(value.dirty)) { return undefined; }
  const review = value.review === undefined ? undefined : parseReview(value.review);
  if (value.review !== undefined && !review) { return undefined; }
  if (value.mathPreview !== undefined && !isBoolean(value.mathPreview)) { return undefined; }
  if (value.spelling !== undefined && !isBoolean(value.spelling)) { return undefined; }
  const typing = value.typing === undefined ? undefined : parseTypingHelpers(value.typing);
  if (value.typing !== undefined && !typing) { return undefined; }
  const selectionPopup = value.selectionPopup === undefined ? undefined : parseSelectionPopupMessage(value.selectionPopup);
  if (value.selectionPopup !== undefined && !selectionPopup) { return undefined; }
  return {
    type: "init", path: value.path, projectId: value.projectId, language: value.language, text: value.text,
    lineBreak: value.lineBreak, version: value.version, readOnly: value.readOnly, dirty: value.dirty,
    ...(review && { review }), ...(value.mathPreview !== undefined && { mathPreview: value.mathPreview }),
    ...(value.spelling !== undefined && { spelling: value.spelling }), ...(typing && { typing }), ...(selectionPopup && { selectionPopup }),
  };
}

function parseInboundBody(value: Record<string, unknown>): SourceEditorInbound | undefined {
  switch (value.type) {
    case "init":
      return parseInit(value);
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
    case "suggestions": {
      const suggestions = parseSuggestions(value.suggestions);
      return suggestions && { type: "suggestions", suggestions };
    }
    case "codeChanged": case "outputsChanged":
      return { type: value.type };
    case "typing": {
      const typing = parseTypingHelpers(value.typing);
      return typing && { type: "typing", typing };
    }
    case "selectionPopup": {
      const selectionPopup = parseSelectionPopupMessage(value.selectionPopup);
      return selectionPopup && { type: "selectionPopup", selectionPopup };
    }
    default:
      return undefined;
  }
}

/** An image as it crosses the wire: its file name and its bytes in base64. */
function parseWireImage(value: unknown): { name: string; base64: string } | undefined {
  return isRecord(value) && isString(value.name) && isString(value.base64) ? { name: value.name, base64: value.base64 } : undefined;
}

/** A file path with an optional line, as the requests that open a file take. */
function parsePathAtLine(p: unknown): Record<string, unknown> | undefined {
  if (!isRecord(p) || !isString(p.path)) { return undefined; }
  if (p.line === undefined) { return { path: p.path }; }
  return isNumber(p.line) ? { path: p.path, line: p.line } : undefined;
}

/** A scope record read with the store's own strict reader, so the wire takes exactly what citations.json keeps; unknown keys are dropped. */
function parseScopeRecord(value: unknown): CitationScopeRecord | undefined {
  if (!isRecord(value)) { return undefined; }
  const records = parseCitationScopes(formatCitationScopes([value as unknown as CitationScopeRecord]));
  return records.length === 1 ? records[0] : undefined;
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
  writeFile: (p) => isRecord(p) && isString(p.path) && isString(p.text) ? { path: p.path, text: p.text } : undefined,
  openNotes: (p) => isRecord(p) && isString(p.paperId) ? { paperId: p.paperId } : undefined,
  highlightsOf: (p) => isRecord(p) && isString(p.paperId) ? { paperId: p.paperId } : undefined,
  openPaper: (p) => {
    if (!isRecord(p) || !isString(p.paperId)) { return undefined; }
    if (p.page === undefined) { return { paperId: p.paperId }; }
    return isNumber(p.page) ? { paperId: p.paperId, page: p.page } : undefined;
  },
  openFile: parsePathAtLine,
  addComment: (p) => isRecord(p) && isNumber(p.from) && isNumber(p.to) && isString(p.text) ? { from: p.from, to: p.to, text: p.text } : undefined,
  openComments: (p) => {
    if (!isRecord(p)) { return undefined; }
    if (p.id === undefined) { return {}; }
    return isString(p.id) ? { id: p.id } : undefined;
  },
  runAction: (p) => isRecord(p) && isOneOf(SOURCE_EDITOR_ACTIONS, p.action) ? { action: p.action } : undefined,
  disableMathPreview: (p) => isRecord(p) ? {} : undefined,
  listCodeFiles: (p) => isRecord(p) ? {} : undefined,
  readCodeFile: (p) => isRecord(p) && isString(p.path) ? { path: p.path } : undefined,
  openCodeFile: parsePathAtLine,
  browseCodeFile: (p) => isRecord(p) ? {} : undefined,
  dictionaryList: (p) => isRecord(p) ? {} : undefined,
  dictionaryRead: (p) => isRecord(p) && isString(p.tag) ? { tag: p.tag } : undefined,
  dictionaryInstall: (p) => isRecord(p) && isString(p.tag) ? { tag: p.tag } : undefined,
  userWords: (p) => isRecord(p) ? {} : undefined,
  addUserWord: (p) => isRecord(p) && isString(p.word) ? { word: p.word } : undefined,
  disableSpelling: (p) => isRecord(p) ? {} : undefined,
  setSpelling: (p) => isRecord(p) && isBoolean(p.on) ? { on: p.on } : undefined,
  setTyping: (p) => {
    const typing = isRecord(p) ? parseTypingHelpers(p.typing) : undefined;
    return typing && { typing };
  },
  setSelectionPopup: (p) => {
    const selectionPopup = isRecord(p) ? parseSelectionPopupMessage(p.selectionPopup) : undefined;
    return selectionPopup && { selectionPopup };
  },
  pdfAssets: (p) => isRecord(p) ? {} : undefined,
  paperPdf: (p) => isRecord(p) && isString(p.paperId) ? { paperId: p.paperId } : undefined,
  citationScopes: (p) => isRecord(p) && isString(p.file) ? { file: p.file } : undefined,
  saveCitationScope: (p) => {
    const record = isRecord(p) ? parseScopeRecord(p.record) : undefined;
    return record && { record };
  },
  deckPdf: (p) => isRecord(p) ? {} : undefined,
  deckBuild: (p) => isRecord(p) ? {} : undefined,
  deckPickImage: (p) => isRecord(p) ? {} : undefined,
  deckDropImage: (p) => isRecord(p) && Array.isArray(p.uris) && p.uris.every(isString) ? { uris: p.uris as string[] } : undefined,
  deckExportPdf: (p) => isRecord(p) ? {} : undefined,
  deckStylePreview: (p) => isRecord(p) && typeof p.text === "string" && typeof p.key === "string" && isNumber(p.page) ? { path: typeof p.path === "string" ? p.path : "", text: p.text, page: p.page, key: p.key } : undefined,
  showProblems: (p) => isRecord(p) ? {} : undefined,
  deckKits: (p) => isRecord(p) ? {} : undefined,
  deckSaveKit: (p) => {
    if (!isRecord(p) || !isRecord(p.kit)) { return undefined; }
    if (p.logo === undefined) { return { kit: p.kit }; }
    const logo = parseWireImage(p.logo);
    return logo && { kit: p.kit, logo };
  },
  deckPickKitImage: (p) => isRecord(p) ? {} : undefined,
  ...OUTPUT_REQUEST_PARAMS,
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
    case "addSuggestions": {
      const suggestions = parseSuggestions(value.suggestions);
      return suggestions && { type: "addSuggestions", suggestions };
    }
    case "removeSuggestions": {
      const ids = parseList(value.ids, (id) => isString(id) ? id : undefined);
      return ids && { type: "removeSuggestions", ids };
    }
    case "reviewMode":
      return isOneOf(REVIEW_MODES, value.mode) ? { type: "reviewMode", mode: value.mode } : undefined;
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
