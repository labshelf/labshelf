/** Declares and validates the requests a preview reader sends its host. */
// CONTRACT: documents/contracts/reader-host.md#preview
import { LATEX_ENGINES, type CountUpTo, type LatexEngine } from "../writing/project/index.js";
import { isCitationQuery, isPagePoint, type CitationQuery, type PagePoint } from "./previewProtocol.js";

/** The project commands a preview reader can run on the shown root's project. */
export const PROJECT_COMMANDS = ["compareVersions", "markVersion", "checkBeforeSubmitting"] as const;
export type ProjectCommandId = (typeof PROJECT_COMMANDS)[number];

/** A change to the project's check limits: a number sets a limit, null removes it, an absent field keeps it. */
export interface CheckLimitsChange {
  pages?: number | null;
  words?: number | null;
  countUpTo?: CountUpTo;
}

/** A citation fix the reader applies: replace a key at its `\cite`, or update or add the key's paper. */
export type CitationFix =
  | { kind: "replace"; key: string; replacement: string; file: string; line: number }
  | { kind: "update" | "add"; key: string };

export type PreviewRequest =
  /** The reader double-clicked this point; a preview host opens the source behind it. */
  | { command: "showSource"; point: PagePoint }
  /** Asks a preview host which cited papers stand behind a link or a citation in the PDF. */
  | { command: "lookupCitation"; request: number; query: CitationQuery }
  /** Opens a library paper named by a `citation` answer, at `page` when given. */
  | { command: "openCitedPaper"; paperId: string; page?: number }
  /** Asks a preview host to build the shown root again. */
  | { command: "recompile" }
  /** Asks a preview host to scroll the reader to the editor cursor. */
  | { command: "revealCursor" }
  /** Opens the source of the `index`-th problem of a build root. */
  | { command: "openProblem"; root: string; index: number }
  /** Opens the raw build log of a build root. */
  | { command: "openRawLog"; root: string }
  /** Reports how many pages of the PDF a build root produced hold the paper's body. */
  | { command: "bodyPages"; root: string; contentPages: number }
  | { command: "runCommand"; id: ProjectCommandId }
  | { command: "setAutoCompile"; on: boolean }
  | { command: "setEngine"; engine: LatexEngine }
  | { command: "setIncludeOnly"; on: boolean }
  | { command: "setCheckLimits"; limits: CheckLimitsChange }
  | { command: "fixCitation"; fix: CitationFix }
  /** Opens a source line; `file` is relative to the project folder, `line` counts from 1. */
  | { command: "openSourceLine"; file: string; line: number }
  /** A review note on the selected text at `point`; a preview host adds it as a comment at the source behind it. */
  | { command: "addReviewComment"; point: PagePoint; quote: string; note: string };

type Fields = Record<string, unknown>;

const isStr = (v: unknown): v is string => typeof v === "string";
const isFilled = (v: unknown): v is string => isStr(v) && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): boolean => isNum(v) && Number.isInteger(v) && v >= 0;
const isLine = (v: unknown): boolean => isCount(v) && (v as number) >= 1;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isObj = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isOneOf = (list: readonly string[], v: unknown): boolean => isStr(v) && list.includes(v);

const isLimit = (v: unknown): boolean => v === undefined || v === null || isLine(v);

const isLimitsChange = (v: unknown): boolean =>
  isObj(v) && isLimit(v["pages"]) && isLimit(v["words"])
  && (v["countUpTo"] === undefined || v["countUpTo"] === "references" || v["countUpTo"] === "end");

function isCitationFix(v: unknown): boolean {
  if (!isObj(v) || !isFilled(v["key"])) { return false; }
  if (v["kind"] === "replace") { return isFilled(v["replacement"]) && isFilled(v["file"]) && isLine(v["line"]); }
  return v["kind"] === "update" || v["kind"] === "add";
}

const GUARDS: { [C in PreviewRequest["command"]]: (m: Fields) => boolean } = {
  showSource: (m) => isPagePoint(m["point"]),
  lookupCitation: (m) => isNum(m["request"]) && isCitationQuery(m["query"]),
  openCitedPaper: (m) => isFilled(m["paperId"]) && (m["page"] === undefined || isLine(m["page"])),
  recompile: () => true,
  revealCursor: () => true,
  openProblem: (m) => isFilled(m["root"]) && isCount(m["index"]),
  openRawLog: (m) => isFilled(m["root"]),
  bodyPages: (m) => isFilled(m["root"]) && isCount(m["contentPages"]),
  runCommand: (m) => isOneOf(PROJECT_COMMANDS, m["id"]),
  setAutoCompile: (m) => isBool(m["on"]),
  setEngine: (m) => isOneOf(LATEX_ENGINES, m["engine"]),
  setIncludeOnly: (m) => isBool(m["on"]),
  setCheckLimits: (m) => isLimitsChange(m["limits"]),
  fixCitation: (m) => isCitationFix(m["fix"]),
  openSourceLine: (m) => isFilled(m["file"]) && isLine(m["line"]),
  addReviewComment: (m) => isPagePoint(m["point"]) && isStr(m["quote"]) && isStr(m["note"]) && m["note"].trim().length > 0,
};

/**
 * Validates an untrusted message as a preview request.
 * @returns null when `m.command` names no preview request, else whether the payload is well formed.
 */
export function checkPreviewRequest(m: Fields): boolean | null {
  const command = m["command"];
  if (!isStr(command) || !Object.hasOwn(GUARDS, command)) { return null; }
  return GUARDS[command as PreviewRequest["command"]](m);
}
