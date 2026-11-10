/** Reads what a listing points at in its file now, compares it with the manuscript's copy, and builds the insert, the update and the two sides of a comparison. */
// CONTRACT: documents/contracts/library-format.md#code-listings
import type { LatexRange } from "../../latex/index.js";
import { deriveOriginState, type OriginState } from "../noteLinks/index.js";
import { deriveCodeLanguage, deriveCodeLinkHash, normalizeCode } from "./codeLanguages.js";
import { buildListing, buildListingUpdate, scanCodeLinks, type ListingStyle, type ManuscriptCodeLink } from "./codeListing.js";
import { findCodeSymbol, listCodeSymbols } from "./codeSymbols.js";
import type { CodeAnchor, ManuscriptFormat } from "./codeSyntax.js";

/** Where the code files are read from; each host implements it over its own file access. */
export interface CodeLinkSource {
  /** The text of a file named relative to the project folder (it may climb out with `../`); undefined when it does not exist. Throws when this app cannot read it. */
  read(path: string): Promise<string | undefined>;
}

/** A part of a code file, ready to be inserted or compared. */
export interface CodeExcerpt {
  path: string;
  anchor: CodeAnchor;
  /** Normalised. */
  code: string;
}

export interface ResolvedCodeLink {
  link: ManuscriptCodeLink;
  /** Undefined when the file cannot be read here: the listing gets no state and no mark. */
  state: OriginState | undefined;
  /** The file's code for the link now; a line anchor that moved carries its new lines. Absent when `missing` or unread. */
  current?: CodeExcerpt;
  /** A line anchor whose unchanged code is now at other lines; its state is `stale`. */
  moved: boolean;
}

const splitLines = (text: string): string[] => text.replace(/\r\n?/g, "\n").split("\n");

/** The code an anchor names in the file's text; undefined when the name is not defined or the lines are past the end. */
export function readCodeExcerpt(path: string, fileText: string, anchor: CodeAnchor): CodeExcerpt | undefined {
  const lines = splitLines(fileText);
  switch (anchor.kind) {
    case "file": return { path, anchor, code: normalizeCode(fileText) };
    case "lines":
      if (anchor.end > lines.length) { return undefined; }
      return { path, anchor, code: normalizeCode(lines.slice(anchor.start - 1, anchor.end).join("\n")) };
    case "symbol": {
      const language = deriveCodeLanguage(path)?.symbols;
      const symbol = language && findCodeSymbol(language, fileText, anchor.name);
      return symbol ? { path, anchor, code: normalizeCode(lines.slice(symbol.startLine, symbol.endLine + 1).join("\n")) } : undefined;
    }
  }
}

/**
 * The excerpt for 0-based lines picked in the file: the definition they cover exactly when there is one, so the link survives edits around it;
 * otherwise those lines without the blank ones around them.
 */
export function excerptFromLines(path: string, fileText: string, startLine: number, endLine: number): CodeExcerpt {
  const lines = splitLines(fileText);
  let start = Math.max(0, startLine);
  let end = Math.min(lines.length - 1, endLine);
  while (start < end && lines[start]!.trim() === "") { start++; }
  while (end > start && lines[end]!.trim() === "") { end--; }
  const language = deriveCodeLanguage(path)?.symbols;
  const symbol = language && listCodeSymbols(language, fileText).find((candidate) => candidate.startLine === start && candidate.endLine === end);
  // A name defined twice links to its first definition, so only that one can be linked by name.
  if (symbol && findCodeSymbol(language, fileText, symbol.name)?.startLine === symbol.startLine) { return readCodeExcerpt(path, fileText, { kind: "symbol", name: symbol.name })!; }
  return { path, anchor: { kind: "lines", start: start + 1, end: end + 1 }, code: normalizeCode(lines.slice(start, end + 1).join("\n")) };
}

/** The listing with its link comments, ready to put at the cursor. Throws when the code would end the listing early. */
export async function buildCodeInsert(format: ManuscriptFormat, style: ListingStyle, excerpt: CodeExcerpt): Promise<string> {
  const hash = await deriveCodeLinkHash(excerpt.code);
  return buildListing({ format, style, language: deriveCodeLanguage(excerpt.path), code: excerpt.code, ref: { path: excerpt.path, anchor: excerpt.anchor, hash } });
}

/** Where a line anchor's unchanged code is now: the first lines of the file that hold exactly that code. */
function findMovedLines(path: string, fileText: string, link: Pick<ManuscriptCodeLink, "code">, anchor: Extract<CodeAnchor, { kind: "lines" }>): CodeExcerpt | undefined {
  const lines = splitLines(fileText);
  const size = anchor.end - anchor.start + 1;
  for (let start = 0; start + size <= lines.length; start++) {
    if (normalizeCode(lines.slice(start, start + size).join("\n")) === link.code) {
      return { path, anchor: { kind: "lines", start: start + 1, end: start + size }, code: link.code };
    }
  }
  return undefined;
}

/**
 * The 1-based lines a listing's anchor covers in the file's text now: a name's definition (decorators included), a line anchor's
 * code where it moved when the manuscript's copy is found at other lines, else the recorded lines, and line 1 for a whole file.
 * Undefined when the name is not defined in the file.
 */
export function findCodeLinkLines(link: Pick<ManuscriptCodeLink, "path" | "anchor" | "code">, fileText: string): { start: number; end: number } | undefined {
  const { anchor } = link;
  switch (anchor.kind) {
    case "file": return { start: 1, end: 1 };
    case "symbol": {
      const language = deriveCodeLanguage(link.path)?.symbols;
      const symbol = language && findCodeSymbol(language, fileText, anchor.name);
      return symbol ? { start: symbol.startLine + 1, end: symbol.endLine + 1 } : undefined;
    }
    case "lines": {
      const atRecorded = readCodeExcerpt(link.path, fileText, anchor);
      const moved = atRecorded?.code === link.code ? undefined : findMovedLines(link.path, fileText, link, anchor)?.anchor;
      return moved?.kind === "lines" ? { start: moved.start, end: moved.end } : { start: anchor.start, end: anchor.end };
    }
  }
}

/** The state of one listing; `read` is the file's text, undefined when the file does not exist. */
async function resolveOne(link: ManuscriptCodeLink, read: () => Promise<string | undefined>): Promise<ResolvedCodeLink> {
  let fileText: string | undefined;
  try {
    fileText = await read();
  } catch {
    return { link, state: undefined, moved: false };
  }
  const manuscriptHash = await deriveCodeLinkHash(link.code);
  if (fileText === undefined) { return { link, state: "missing", moved: false }; }
  const { anchor } = link;
  if (anchor.kind === "lines" && manuscriptHash === link.hash) {
    const atRecorded = readCodeExcerpt(link.path, fileText, anchor);
    if (atRecorded?.code !== link.code) {
      const moved = findMovedLines(link.path, fileText, link, anchor);
      if (moved) { return { link, state: "stale", current: moved, moved: true }; }
    }
  }
  const current = readCodeExcerpt(link.path, fileText, anchor);
  if (!current) { return { link, state: "missing", moved: false }; }
  const state = deriveOriginState({ hash: link.hash }, manuscriptHash, { hash: await deriveCodeLinkHash(current.code) });
  return { link, state, current, moved: false };
}

/** The state of every listing of the manuscript; each file is read once. */
export async function resolveCodeLinks(format: ManuscriptFormat, text: string, source: CodeLinkSource): Promise<ResolvedCodeLink[]> {
  const reads = new Map<string, Promise<string | undefined>>();
  const read = (path: string): Promise<string | undefined> => {
    let pending = reads.get(path);
    if (!pending) { pending = source.read(path); reads.set(path, pending); }
    return pending;
  };
  return Promise.all(scanCodeLinks(format, text).map((link) => resolveOne(link, () => read(link.path))));
}

/** The edit that replaces a `stale` listing's code and opening comment with the file's; undefined for any other state. */
export async function buildCodeUpdate(format: ManuscriptFormat, text: string, resolved: ResolvedCodeLink): Promise<{ range: LatexRange; text: string } | undefined> {
  const { link, state, current } = resolved;
  if (state !== "stale" || !current) { return undefined; }
  const ref = { path: link.path, anchor: current.anchor, hash: await deriveCodeLinkHash(current.code) };
  return buildListingUpdate(format, text, link, ref, current.code);
}

/** The manuscript's copy and the file's code, for a side-by-side view. */
export function diffCodeLink(resolved: ResolvedCodeLink): { manuscript: string; file: string } {
  return { manuscript: resolved.link.code, file: resolved.current?.code ?? "" };
}

/** The sentence a mark and its hover say about a listing; a fresh or unread listing has none. */
export function describeCodeLinkState(resolved: ResolvedCodeLink): string | undefined {
  const { link, state, current, moved } = resolved;
  const name = link.anchor.kind === "symbol" ? link.anchor.name : link.path.slice(link.path.lastIndexOf("/") + 1);
  switch (state) {
    case "stale":
      if (moved && current?.anchor.kind === "lines") { return `${name}: the code moved to lines ${current.anchor.start}–${current.anchor.end} of ${link.path}. Update from code records the new lines.`; }
      return `${name}: the code changed in ${link.path} since it was inserted. Update from code replaces this copy.`;
    case "diverged": return `${name}: edited here, so it differs from ${link.path}. LabShelf will not overwrite it.`;
    case "both": return `${name}: edited here and changed in ${link.path}. LabShelf will not overwrite it.`;
    case "missing": return link.anchor.kind === "symbol"
      ? `${name}: not found in ${link.path}. The file or the definition was removed or renamed.`
      : `${name}: ${link.path} or these lines no longer exist.`;
    default: return undefined;
  }
}

/** How the anchor reads to a person: `fit_model`, `lines 40–60` or the file's name. */
export function describeAnchor(path: string, anchor: CodeAnchor): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  switch (anchor.kind) {
    case "file": return file;
    case "symbol": return `${anchor.name} in ${file}`;
    case "lines": return `lines ${anchor.start}–${anchor.end} of ${file}`;
  }
}
