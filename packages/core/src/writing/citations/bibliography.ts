/** Reads and writes .bib text: parsing the entries of a .bib file, the preprint ids an entry names, the text of a project's generated labshelf.bib, the bibliography line of its main file, and regenerating the file from the keys its sources cite. */

import { createBibtexEntry } from "../../import/bibtex/index.js";
import { extractArxivIdentifierFromDoi, extractArxivIdentifierFromUrl, extractDoi, normalizeArxivIdentifier, type PreprintIds } from "../../import/index.js";
import { mergeGeneratedBibliography } from "../../collab/index.js";
import type { PaperRecord } from "../../model/index.js";
import {
  readOptionalText, DEFAULT_BIBLIOGRAPHY, updateProjectSettings, type ProjectReadContext, type OpenSources, type ProjectFormat,
} from "../project/index.js";
import { escapeRegExp } from "../search/index.js";
import { derivePapersByCiteKey, scanCiteKeys } from "./citeKeys.js";
import { DISK_ONLY, walkProjectSources } from "./projectSources.js";
import { syncProjectPapers, type BibliographyUpdate, type CitingProject } from "./papersSync.js";

// --- Parsing .bib ---

export interface BibEntry {
  /** Entry type in lower case: `article`, `inproceedings`, `misc`… */
  type: string;
  key: string;
  /** Field values by lower-case name, without the outer braces or quotes; inner braces stay. */
  fields: ReadonlyMap<string, string>;
  /** Character offsets of the entry, from its `@` to its closing delimiter inclusive. */
  start: number;
  end: number;
}

// These are not citable entries; their bodies are skipped whole.
const NON_ENTRIES = new Set(["comment", "preamble", "string"]);
const ENTRY_HEAD = /@\s*([A-Za-z]+)\s*([{(])/y;
const FIELD_NAME = /\s*([^\s=,{}()"#%]+)\s*=\s*/y;

/** Every citable entry in text order; a malformed entry is skipped and parsing resumes after it. */
export function parseBibEntries(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let at = nextEntryStart(text, 0);
  while (at >= 0) {
    ENTRY_HEAD.lastIndex = at;
    const head = ENTRY_HEAD.exec(text);
    if (!head) { at = nextEntryStart(text, at + 1); continue; }
    const close = head[2] === "{" ? "}" : ")";
    const bodyStart = ENTRY_HEAD.lastIndex;
    const type = head[1]!.toLowerCase();
    const end = NON_ENTRIES.has(type) ? balancedEnd(text, bodyStart - 1) : -1;
    if (NON_ENTRIES.has(type)) { at = nextEntryStart(text, end < 0 ? bodyStart : end); continue; }
    const entry = parseBody(text, bodyStart, close);
    if (entry) { entries.push({ type, key: entry.key, fields: entry.fields, start: at, end: entry.end }); }
    at = nextEntryStart(text, entry ? entry.end : bodyStart);
  }
  return entries;
}

/** A field value as plain text: inner braces removed and whitespace collapsed, for comparisons and lookups. */
export function extractPlainField(value: string | undefined): string {
  return (value ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

// Biber reads `%` to the end of the line as a comment outside entries, so an `@` after one starts nothing.
function nextEntryStart(text: string, from: number): number {
  for (let at = text.indexOf("@", from); at >= 0; at = text.indexOf("@", at + 1)) {
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    if (!text.slice(lineStart, at).includes("%")) { return at; }
  }
  return -1;
}

function parseBody(text: string, from: number, close: string): { key: string; fields: Map<string, string>; end: number } | undefined {
  const comma = text.indexOf(",", from);
  const closeAt = text.indexOf(close, from);
  // An entry with only a key (`@misc{key}`) is valid and has no fields.
  if (closeAt >= 0 && (comma < 0 || closeAt < comma)) {
    const key = text.slice(from, closeAt).trim();
    return key ? { key, fields: new Map(), end: closeAt + 1 } : undefined;
  }
  if (comma < 0) { return undefined; }
  const key = text.slice(from, comma).trim();
  if (!key || /[\s@{}]/.test(key)) { return undefined; }
  const fields = new Map<string, string>();
  let at = comma + 1;
  for (;;) {
    at = skipSpace(text, at);
    if (text[at] === close) { return { key, fields, end: at + 1 }; }
    if (text[at] === ",") { at += 1; continue; }
    FIELD_NAME.lastIndex = at;
    const name = FIELD_NAME.exec(text);
    if (!name) { return undefined; }
    const value = readValue(text, FIELD_NAME.lastIndex);
    if (!value) { return undefined; }
    fields.set(name[1]!.toLowerCase(), value.text);
    at = value.end;
  }
}

// A value is one or more parts joined by `#`: `{…}`, `"…"`, a number or a @string macro name.
function readValue(text: string, from: number): { text: string; end: number } | undefined {
  const parts: string[] = [];
  let at = from;
  for (;;) {
    at = skipSpace(text, at);
    const part = readPart(text, at);
    if (!part) { return undefined; }
    parts.push(part.text);
    at = skipSpace(text, part.end);
    if (text[at] !== "#") { return { text: parts.join(""), end: at }; }
    at += 1;
  }
}

function readPart(text: string, at: number): { text: string; end: number } | undefined {
  if (text[at] === "{") {
    const end = balancedEnd(text, at);
    return end < 0 ? undefined : { text: text.slice(at + 1, end - 1), end };
  }
  if (text[at] === "\"") {
    // A quote inside braces is text, so the closing quote is the first one at brace depth zero.
    let depth = 0;
    for (let i = at + 1; i < text.length; i++) {
      if (text[i] === "{") { depth += 1; } else if (text[i] === "}") { depth -= 1; }
      else if (text[i] === "\"" && depth === 0) { return { text: text.slice(at + 1, i), end: i + 1 }; }
    }
    return undefined;
  }
  const bare = /[^\s,#{}()"]+/y;
  bare.lastIndex = at;
  const match = bare.exec(text);
  return match ? { text: match[0], end: bare.lastIndex } : undefined;
}

/** The offset just after the delimiter that closes the one at `open`, or -1 when it never closes. */
function balancedEnd(text: string, open: number): number {
  const opener = text[open]!;
  const closer = opener === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) { depth += 1; } else if (text[i] === closer && (depth -= 1) === 0) { return i + 1; }
  }
  return -1;
}

function skipSpace(text: string, at: number): number {
  while (at < text.length && /\s/.test(text[at]!)) { at += 1; }
  return at;
}

// --- Preprint identifiers ---

// arXiv's own DOIs and bioRxiv/medRxiv's name the preprint itself.
const PREPRINT_DOI = /^10\.(48550|1101)\//i;
// Google Scholar writes `journal = {arXiv preprint arXiv:1706.03762}`.
const ARXIV_IN_TEXT = /arxiv:\s*(\S+)/i;

/** The ids to look the published version up by, or undefined when the entry is not a preprint or already has a journal DOI. */
export function extractPreprintIdentifiers(entry: BibEntry): PreprintIds | undefined {
  const doi = extractDoi(extractPlainField(entry.fields.get("doi")));
  if (doi && !PREPRINT_DOI.test(doi)) { return undefined; }
  const arxivId = arxivIdOf(entry) ?? extractArxivIdentifierFromDoi(doi);
  return arxivId || doi ? { arxivId, doi } : undefined;
}

function arxivIdOf(entry: BibEntry): string | undefined {
  const field = (name: string): string => extractPlainField(entry.fields.get(name));
  const eprint = normalizeArxivIdentifier(field("eprint"));
  // A bare new-style eprint is an arXiv id even without `archivePrefix`; other servers use other id shapes.
  if (eprint) { return eprint; }
  const url = extractArxivIdentifierFromUrl(field("url"));
  if (url) { return url; }
  for (const name of ["journal", "note", "howpublished"]) {
    const typed = ARXIV_IN_TEXT.exec(field(name))?.[1];
    const id = typed ? normalizeArxivIdentifier(typed.replace(/[.,;]+$/, "")) : undefined;
    if (id) { return id; }
  }
  return undefined;
}

// --- Generated labshelf.bib ---
// CONTRACT: documents/contracts/library-format.md#generated-files

export const BIBLIOGRAPHY_HEADER = "% Generated by LabShelf from the library papers this project cites. Edits are overwritten.";

export interface GeneratedBibliography {
  text: string;
  /** Cited keys with an entry in the file, sorted. */
  resolved: string[];
  /** Cited keys no library paper has; they are left to the user's own .bib files. */
  missing: string[];
}

/** The same keys and papers always give the same bytes: entries in key order, no file paths, LF line ends. */
export function createBibliography(keys: readonly string[], papers: readonly PaperRecord[]): GeneratedBibliography {
  const library = derivePapersByCiteKey(papers);
  const sorted = [...new Set(keys)].sort();
  const resolved = sorted.filter((key) => library.has(key));
  const missing = sorted.filter((key) => !library.has(key));
  // BibTeX keys are case-sensitive, so `Smith2020` and `smith2020` are different citations.
  const entries = resolved.map((key) => createBibtexEntry(library.get(key)!, { includeFile: false }));
  const text = [BIBLIOGRAPHY_HEADER, ...entries].join("\n\n") + "\n";
  return { text, resolved, missing };
}

// --- Main-file line ---

export type BibliographyLineResult =
  | { kind: "present" | "added"; text: string }
  /** Typst accepts one bibliography call; an existing one is the user's to extend. */
  | { kind: "conflict"; text: string };

function latexLine(text: string, bibFile: string): BibliographyLineResult {
  const base = bibFile.replace(/\.bib$/, "");
  if (new RegExp(`\\\\(?:bibliography|addbibresource)\\{[^}]*\\b${escapeRegExp(base)}(?:\\.bib)?\\b`).test(text)) {
    return { kind: "present", text };
  }
  const resources = [...text.matchAll(/^[ \t]*\\addbibresource\{[^}]*\}[^\n]*$/gm)];
  const last = resources.at(-1);
  if (last) {
    const end = last.index + last[0].length;
    return { kind: "added", text: `${text.slice(0, end)}\n\\addbibresource{${bibFile}}${text.slice(end)}` };
  }
  if (/\\bibliography\{/.test(text)) {
    return { kind: "added", text: text.replace(/\\bibliography\{([^}]*)\}/, (_, list: string) => `\\bibliography{${list},${base}}`) };
  }
  const lines = `\\bibliographystyle{plain}\n\\bibliography{${base}}\n\n`;
  const close = text.lastIndexOf("\\end{document}");
  if (close < 0) { return { kind: "added", text: `${text}\n${lines}` }; }
  return { kind: "added", text: `${text.slice(0, close)}${lines}${text.slice(close)}` };
}

function typstLine(text: string, bibFile: string): BibliographyLineResult {
  if (new RegExp(`#bibliography\\([^)]*"${escapeRegExp(bibFile)}"`).test(text)) { return { kind: "present", text }; }
  if (/#bibliography\(/.test(text)) { return { kind: "conflict", text }; }
  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return { kind: "added", text: `${text}${separator}#bibliography("${bibFile}")\n` };
}

/** The main file's text with the line that loads the generated bibliography, added once; `bibFile` is relative to the main file's folder. */
export function withBibliographyLine(format: ProjectFormat, text: string, bibFile: string): BibliographyLineResult {
  return format === "latex" ? latexLine(text, bibFile) : typstLine(text, bibFile);
}

// --- Regenerating labshelf.bib ---
// CONTRACT: documents/contracts/library-format.md#generated-files

/** Keys cited anywhere in the project's sources; hidden folders and node_modules are not sources. */
export async function listProjectCiteKeys(
  context: Pick<ProjectReadContext, "fs" | "paths">, folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): Promise<string[]> {
  const keys = new Set<string>();
  for await (const source of walkProjectSources(context, folder, format, open)) {
    for (const key of scanCiteKeys(format, source.text)) { keys.add(key); }
  }
  return [...keys];
}

async function addMainLine(
  { fs, paths, logger }: ProjectReadContext, project: CitingProject, bibFile: string, open: OpenSources,
): Promise<BibliographyUpdate["mainLine"]> {
  if (project.main === undefined) { return "no-main"; }
  const mainPath = paths.join(project.folder, project.main);
  const text = open.text(mainPath) ?? await readOptionalText(fs, mainPath);
  if (text === undefined) { return "no-main"; }
  const relative = paths.relative(paths.dirname(mainPath), paths.join(project.folder, bibFile)).split(paths.sep).join("/");
  const result = withBibliographyLine(project.settings.format, text, relative);
  // An open main file is edited in the editor, so the user's unsaved changes and undo history survive.
  if (result.kind === "added" && !await open.replace(mainPath, result.text)) { await fs.writeText(mainPath, result.text); }
  if (result.kind === "conflict") {
    await logger.log("WARN", "citations", "main file loads another bibliography", { main: mainPath, bibFile });
  }
  return result.kind;
}

// CONTRACT: documents/contracts/collaboration.md#bibliography
/** A shared labshelf.bib also holds other members' entries, so the generated one is merged in and never replaces it. */
async function mergedIntoShared(
  { logger }: ProjectReadContext, bibPath: string, current: string | undefined, generated: string,
): Promise<string> {
  const merged = mergeGeneratedBibliography(current ?? "", generated);
  for (const clash of merged.clashes) {
    await logger.log("WARN", "citations", "shared bibliography keeps another member's entry under a clashing cite key", { bibPath, ...clash });
  }
  return merged.text;
}

/**
 * Writes labshelf.bib for the project's current citations and keeps the `papers` list of labshelf.yaml in sync with
 * them. The main file and `bibliography:` are touched only until the main file loads labshelf.bib, starting with the
 * first cited library paper and after labshelf.bib exists.
 */
export async function updateProjectBibliography(
  context: ProjectReadContext, project: CitingProject, papers: readonly PaperRecord[], open: OpenSources = DISK_ONLY,
): Promise<BibliographyUpdate> {
  const { fs, paths, logger } = context;
  const bibFile = project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const bibPath = paths.join(project.folder, bibFile);
  const keys = await listProjectCiteKeys(context, project.folder, project.settings.format, open);
  const generated = createBibliography(keys, papers);
  const current = await readOptionalText(fs, bibPath);
  const needed = generated.resolved.length > 0 || current !== undefined;
  const text = project.settings.shared === undefined ? generated.text : await mergedIntoShared(context, bibPath, current, generated.text);
  const written = needed && current !== text;
  if (written) { await fs.writeText(bibPath, text); }
  let mainLine: BibliographyUpdate["mainLine"] = "not-needed";
  // PLATFORM: Typst fails the build when #bibliography names a missing file, so the line follows the file.
  if (generated.resolved.length > 0 && project.settings.bibliography === undefined) {
    mainLine = await addMainLine(context, project, bibFile, open);
    // Recorded only once the main file loads it, so a conflict or a missing main is retried on the next update.
    if (mainLine === "added" || mainLine === "present") {
      await updateProjectSettings(context, project.folder, { bibliography: bibFile });
    }
  }
  const papersWritten = await syncProjectPapers(context, project.folder, keys, papers);
  // Runs on every save, so only a change is worth a log line.
  if (written || mainLine === "added" || papersWritten) {
    await logger.log("INFO", "citations", "project bibliography updated", {
      folder: project.folder, entries: generated.resolved.length, missing: generated.missing.length, mainLine, papersWritten,
    });
  }
  return { written, papersWritten, missing: generated.missing, mainLine };
}
