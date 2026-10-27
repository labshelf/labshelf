/** Declares and validates the requests a preview reader sends its host. */
import { isBoolean, isCount, isNonEmptyString, isNumber, isOneOf, isRecord, isString } from "../guards/index.js";
import { LATEX_ENGINES, type CountUpTo, type LatexEngine } from "../writing/project/index.js";
import { AUTO_COMPILE_MODES, type BuildSchedule } from "../writing/build/index.js";
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
  | { command: "setAutoCompile"; mode: BuildSchedule }
  | { command: "setEngine"; engine: LatexEngine }
  | { command: "setIncludeOnly"; on: boolean }
  | { command: "setHaltOnError"; on: boolean }
  | { command: "setCheckLimits"; limits: CheckLimitsChange }
  | { command: "fixCitation"; fix: CitationFix }
  /** Opens a source line; `file` is relative to the project folder, `line` counts from 1. */
  | { command: "openSourceLine"; file: string; line: number }
  /** A review note on the selected text at `point`; a preview host adds it as a comment at the source behind it. */
  | { command: "addReviewComment"; point: PagePoint; quote: string; note: string };

type Fields = Record<string, unknown>;

const isLine = (v: unknown): boolean => isCount(v) && v >= 1;

const isLimit = (v: unknown): boolean => v === undefined || v === null || isLine(v);

const isLimitsChange = (v: unknown): boolean =>
  isRecord(v) && isLimit(v["pages"]) && isLimit(v["words"])
  && (v["countUpTo"] === undefined || v["countUpTo"] === "references" || v["countUpTo"] === "end");

function isCitationFix(v: unknown): boolean {
  if (!isRecord(v) || !isNonEmptyString(v["key"])) { return false; }
  if (v["kind"] === "replace") { return isNonEmptyString(v["replacement"]) && isNonEmptyString(v["file"]) && isLine(v["line"]); }
  return v["kind"] === "update" || v["kind"] === "add";
}

const GUARDS: { [C in PreviewRequest["command"]]: (m: Fields) => boolean } = {
  showSource: (m) => isPagePoint(m["point"]),
  lookupCitation: (m) => isNumber(m["request"]) && isCitationQuery(m["query"]),
  openCitedPaper: (m) => isNonEmptyString(m["paperId"]) && (m["page"] === undefined || isLine(m["page"])),
  recompile: () => true,
  revealCursor: () => true,
  openProblem: (m) => isNonEmptyString(m["root"]) && isCount(m["index"]),
  openRawLog: (m) => isNonEmptyString(m["root"]),
  bodyPages: (m) => isNonEmptyString(m["root"]) && isCount(m["contentPages"]),
  runCommand: (m) => isOneOf(PROJECT_COMMANDS, m["id"]),
  setAutoCompile: (m) => isOneOf(AUTO_COMPILE_MODES, m["mode"]),
  setEngine: (m) => isOneOf(LATEX_ENGINES, m["engine"]),
  setIncludeOnly: (m) => isBoolean(m["on"]),
  setHaltOnError: (m) => isBoolean(m["on"]),
  setCheckLimits: (m) => isLimitsChange(m["limits"]),
  fixCitation: (m) => isCitationFix(m["fix"]),
  openSourceLine: (m) => isNonEmptyString(m["file"]) && isLine(m["line"]),
  addReviewComment: (m) => isPagePoint(m["point"]) && isString(m["quote"]) && isString(m["note"]) && m["note"].trim().length > 0,
};

/**
 * Validates an untrusted message as a preview request.
 * @returns null when `m.command` names no preview request, else whether the payload is well formed.
 */
export function checkPreviewRequest(m: Fields): boolean | null {
  const command = m["command"];
  if (!isString(command) || !Object.hasOwn(GUARDS, command)) { return null; }
  return GUARDS[command as PreviewRequest["command"]](m);
}
