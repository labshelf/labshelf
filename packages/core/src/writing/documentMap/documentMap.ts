// Builds the document map a build preview's rail shows: the headings of a root with the files it includes expanded in place, the marks
// (comments, suggested edits, equations, figures, tables, images) between them, and the line order that ties both to the PDF.
import type { CommentThread } from "../../collab/comments.js";
import { findThread } from "../../collab/comments.js";
import type { Suggestion } from "../../collab/suggestions.js";
import { findSuggestion } from "../../collab/suggestions.js";
import { removeComments, scanLatexSource } from "../../latex/source.js";
import { resolveIncludePath } from "../../latex/sourceProject.js";
import type { PagePoint } from "../../reader/index.js";
import { deriveLineOffsets, findLineOfOffset } from "../../text/index.js";
import { scanTypstHeadings } from "../../typst/language/index.js";
import type { ProjectFormat } from "../project/index.js";

export const DOCUMENT_MAP_MARK_KINDS = ["comment", "edit", "equation", "figure", "table", "image"] as const;
export type DocumentMapMarkKind = (typeof DOCUMENT_MAP_MARK_KINDS)[number];

/** A place in the expanded source, and in the PDF when SyncTeX knows it. */
export interface DocumentMapPlace {
  /** Project-relative, "/"-separated. */
  file: string;
  /** 1-based. */
  line: number;
  /** The place's line in the root with every include expanded in place, 0-based. */
  at: number;
  /** Where the line's output starts, from the build's SyncTeX data; absent without it. */
  point?: PagePoint;
}

export interface DocumentMapHeading extends DocumentMapPlace {
  /** Smaller is higher; LaTeX runs from part (-1) to subparagraph (5), Typst from 1. */
  level: number;
  title: string;
}

export interface DocumentMapMark extends DocumentMapPlace {
  kind: DocumentMapMarkKind;
  /** What the mark's tooltip says after its kind: a caption, a label, a comment's first words. */
  label?: string;
}

/** Lines `from` to `to` (1-based, inclusive) of `file` sit at `at` onwards in the expanded source. */
export interface DocumentMapSegment {
  file: string;
  from: number;
  to: number;
  at: number;
}

export interface DocumentMap {
  /** The root, project-relative. */
  root: string;
  headings: DocumentMapHeading[];
  /** In source order. */
  marks: DocumentMapMark[];
  /** In source order; together they cover every line of the expanded source once. */
  segments: DocumentMapSegment[];
  /** The body of the expanded source: `\begin{document}` to `\end{document}`, or every line. */
  body: { start: number; end: number };
}

export interface DocumentMapInput {
  format: ProjectFormat;
  /** The root, project-relative. */
  root: string;
  /** The text of a project-relative path, from an open editor first; undefined when the file does not exist. */
  read(path: string): Promise<string | undefined>;
  /** The project's comment threads; resolved ones are left out. */
  threads?: readonly CommentThread[];
  suggestions?: readonly Suggestion[];
  /** Where a source line's output starts in the PDF; absent, or undefined for a line, leaves the place without a point. */
  locate?: (file: string, line: number) => PagePoint | undefined;
}

// Enough for a thesis; past this the rail is dots end to end and the message only grows.
const MAX_MARKS = 3000;
const LABEL_LENGTH = 80;

interface FileFacts {
  headings: { level: number; title: string; line: number }[];
  marks: { kind: DocumentMapMarkKind; line: number; label?: string }[];
  /** Zero-based lines of the includes, with the project-relative file each names. */
  includes: { line: number; target: string }[];
  /** Zero-based lines of `\begin{document}` and `\end{document}`. */
  begin?: number;
  end?: number;
}

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LENGTH ? `${flat.slice(0, LABEL_LENGTH - 1)}…` : flat;
};

const FIGURE_BEGIN = /\\begin\{(figure\*?|wrapfigure|SCfigure|subfigure)\}/;
const FIGURE_END = /\\end\{(figure\*?|wrapfigure|SCfigure|subfigure)\}/;
const TABLE_BEGIN = /\\begin\{(table\*?|longtable|sidewaystable)\}/;
const MATH_BEGIN = /\\begin\{(equation|align|alignat|flalign|gather|multline|eqnarray|displaymath)\*?\}|\\\[|\$\$/;
const CAPTION = /\\caption(?:\[[^\]]*\])?\{([^}]*)\}/;
const LABEL = /\\label\{([^}]*)\}/;
const GRAPHICS = /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/;
// Lines past an opening a caption or label is looked for in.
const LOOKAHEAD = 30;

/** The first match of `pattern` from `line` on, inside the next lines; group 1. */
function findAhead(lines: readonly string[], line: number, pattern: RegExp, stop?: RegExp): string | undefined {
  for (let at = line; at < Math.min(lines.length, line + LOOKAHEAD); at++) {
    const found = pattern.exec(lines[at] ?? "")?.[1];
    if (found !== undefined) { return found; }
    if (stop && at > line && stop.test(lines[at] ?? "")) { return undefined; }
  }
  return undefined;
}

function scanLatexFile(text: string): FileFacts {
  const facts = scanLatexSource(text);
  const lines = removeComments(text).split("\n");
  const marks: FileFacts["marks"] = [];
  let inFigure = 0;
  lines.forEach((row, line) => {
    if (FIGURE_BEGIN.test(row)) {
      const caption = findAhead(lines, line, CAPTION, FIGURE_END);
      marks.push({ kind: "figure", line, ...(caption ? { label: shorten(caption) } : {}) });
      inFigure++;
    } else if (TABLE_BEGIN.test(row)) {
      const caption = findAhead(lines, line, CAPTION, /\\end\{(table|longtable|sidewaystable)/);
      marks.push({ kind: "table", line, ...(caption ? { label: shorten(caption) } : {}) });
    } else if (MATH_BEGIN.test(row)) {
      const label = findAhead(lines, line, LABEL, /\\end\{|\\\]|\$\$/);
      marks.push({ kind: "equation", line, ...(label ? { label } : {}) });
    }
    const graphics = inFigure === 0 ? GRAPHICS.exec(row)?.[1] : undefined;
    if (graphics !== undefined) { marks.push({ kind: "image", line, label: shorten(graphics) }); }
    if (FIGURE_END.test(row)) { inFigure = Math.max(0, inFigure - 1); }
  });
  const includes = facts.includes.flatMap((include) => {
    const target = resolveIncludePath(include.path);
    return target === undefined ? [] : [{ line: include.range.start.line, target }];
  });
  const begin = lines.findIndex((row) => row.includes("\\begin{document}"));
  const end = lines.findIndex((row) => row.includes("\\end{document}"));
  return {
    headings: facts.sections.map((section) => ({ level: section.level, title: section.title, line: section.range.start.line })),
    marks, includes,
    ...(begin >= 0 ? { begin } : {}), ...(end >= 0 ? { end } : {}),
  };
}

function scanTypstFile(text: string): FileFacts {
  const marks: FileFacts["marks"] = [];
  let inFigure = false;
  let depth = 0;
  text.split("\n").forEach((row, line) => {
    const trimmed = row.trimStart();
    if (trimmed.startsWith("//")) { return; }
    if (/#figure\s*\(/.test(row)) {
      const caption = /caption:\s*\[([^\]]*)\]/.exec(row)?.[1];
      marks.push({ kind: "figure", line, ...(caption ? { label: shorten(caption) } : {}) });
      inFigure = true;
      depth = 0;
    } else if (/#table\s*\(/.test(row)) {
      marks.push({ kind: "table", line });
    } else if (/^\$\s/.test(trimmed)) {
      marks.push({ kind: "equation", line });
    }
    const image = /#?image\s*\(\s*"([^"]*)"/.exec(row)?.[1];
    if (image !== undefined && !inFigure) { marks.push({ kind: "image", line, label: shorten(image) }); }
    if (inFigure) {
      for (const char of row) { depth += char === "(" ? 1 : char === ")" ? -1 : 0; }
      if (depth <= 0) { inFigure = false; }
    }
  });
  return { headings: scanTypstHeadings(text).map(({ level, title, line }) => ({ level, title, line })), marks, includes: [] };
}

interface ReadFile {
  path: string;
  text: string;
  facts: FileFacts;
}

/** Reads the root and, depth first, each file it includes, laying the lines out as the build expands them; a file is expanded once. */
async function expand(input: DocumentMapInput): Promise<{ files: Map<string, ReadFile>; segments: DocumentMapSegment[] }> {
  const files = new Map<string, ReadFile>();
  const segments: DocumentMapSegment[] = [];
  let at = 0;
  const emit = (file: string, from: number, to: number): void => {
    if (to < from) { return; }
    segments.push({ file, from, to, at });
    at += to - from + 1;
  };
  const visit = async (path: string): Promise<void> => {
    if (files.has(path)) { return; }
    const text = await input.read(path);
    if (text === undefined) { return; }
    const facts = input.format === "typst" ? scanTypstFile(text) : scanLatexFile(text);
    files.set(path, { path, text, facts });
    const total = text.split("\n").length;
    // Lines count from 1 here; an include's own line comes before what it pulls in.
    let next = 1;
    for (const include of [...facts.includes].sort((a, b) => a.line - b.line)) {
      emit(path, next, include.line + 1);
      next = include.line + 2;
      await visit(include.target);
    }
    emit(path, next, total);
  };
  await visit(input.root);
  return { files, segments };
}

/** The expanded-source line of a file's line; undefined for a file the root does not include. */
export function deriveDocumentMapOrder(segments: readonly DocumentMapSegment[], file: string, line: number): number | undefined {
  const segment = segments.find((each) => each.file === file && line >= each.from && line <= each.to);
  return segment && segment.at + (line - segment.from);
}

/** The file and line at an expanded-source line, clamped to the source. */
export function findDocumentMapLine(segments: readonly DocumentMapSegment[], at: number): { file: string; line: number } | undefined {
  let found: DocumentMapSegment | undefined;
  for (const segment of segments) {
    if (segment.at > at) { break; }
    found = segment;
  }
  found ??= segments[0];
  if (!found) { return undefined; }
  return { file: found.file, line: Math.min(found.to, Math.max(found.from, found.from + (at - found.at))) };
}

function lineOf(text: string, offset: number): number {
  return findLineOfOffset(deriveLineOffsets(text), offset);
}

function reviewMarks(files: ReadonlyMap<string, ReadFile>, threads: readonly CommentThread[], suggestions: readonly Suggestion[]): { file: string; mark: FileFacts["marks"][number] }[] {
  const found: { file: string; mark: FileFacts["marks"][number] }[] = [];
  for (const thread of threads) {
    const file = files.get(thread.file);
    if (thread.resolved || !file) { continue; }
    const range = findThread(thread, file.text);
    if (range === "detached") { continue; }
    const first = thread.comments[0];
    found.push({ file: file.path, mark: { kind: "comment", line: lineOf(file.text, range.start), ...(first ? { label: shorten(`${first.author}: ${first.body}`) } : {}) } });
  }
  const groups = new Set<string>();
  for (const suggestion of suggestions) {
    const file = files.get(suggestion.file);
    if (!file) { continue; }
    // A replacement is a delete and an insert in one group; the rail shows it once.
    if (suggestion.group !== undefined) {
      if (groups.has(suggestion.group)) { continue; }
      groups.add(suggestion.group);
    }
    const range = findSuggestion(suggestion, file.text);
    if (range === "detached") { continue; }
    const what = suggestion.group !== undefined ? "replace" : suggestion.kind;
    found.push({ file: file.path, mark: { kind: "edit", line: lineOf(file.text, range.start), label: shorten(`${suggestion.author}: ${what} “${suggestion.kind === "delete" ? suggestion.text ?? "" : suggestion.anchor.quote}”`) } });
  }
  return found;
}

/** The map of a root: its headings and marks in expanded-source order, each with its PDF point when `locate` finds one. */
export async function buildDocumentMap(input: DocumentMapInput): Promise<DocumentMap> {
  const { files, segments } = await expand(input);
  const place = (file: string, zeroBasedLine: number): DocumentMapPlace | undefined => {
    const line = zeroBasedLine + 1;
    const at = deriveDocumentMapOrder(segments, file, line);
    if (at === undefined) { return undefined; }
    const point = input.locate?.(file, line);
    return { file, line, at, ...(point ? { point } : {}) };
  };
  const headings: DocumentMapHeading[] = [];
  const marks: DocumentMapMark[] = [];
  for (const file of files.values()) {
    for (const heading of file.facts.headings) {
      const at = place(file.path, heading.line);
      if (at) { headings.push({ ...at, level: heading.level, title: heading.title || "Untitled" }); }
    }
    for (const mark of file.facts.marks) {
      const at = place(file.path, mark.line);
      if (at) { marks.push({ ...at, kind: mark.kind, ...(mark.label ? { label: mark.label } : {}) }); }
    }
  }
  for (const { file, mark } of reviewMarks(files, input.threads ?? [], input.suggestions ?? [])) {
    const at = place(file, mark.line);
    if (at) { marks.push({ ...at, kind: mark.kind, ...(mark.label ? { label: mark.label } : {}) }); }
  }
  headings.sort((a, b) => a.at - b.at);
  marks.sort((a, b) => a.at - b.at);
  const total = segments.reduce((sum, segment) => sum + segment.to - segment.from + 1, 0);
  const root = files.get(input.root)?.facts;
  const start = root?.begin !== undefined ? deriveDocumentMapOrder(segments, input.root, root.begin + 1) : undefined;
  const end = root?.end !== undefined ? deriveDocumentMapOrder(segments, input.root, root.end + 1) : undefined;
  return { root: input.root, headings, marks: marks.slice(0, MAX_MARKS), segments, body: { start: start ?? 0, end: Math.max(end ?? total, (start ?? 0) + 1) } };
}

// --- Placing: the rail knows the height of some headings (SyncTeX, the PDF outline) and places the rest between them ---

/** Folds a heading's title to compare it with a PDF outline entry: macros, braces and punctuation go, case and spacing do not count. */
export function foldHeadingTitle(title: string): string {
  return title
    .replace(/\\[A-Za-z@]+\*?/g, " ").replace(/[{}$~\\]/g, " ")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Pairs headings with outline entries in order: each heading takes the next entry with the same folded title. */
export function matchDocumentMapOutline(headings: readonly { title: string }[], rows: readonly { title: string }[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const folded = rows.map((row) => foldHeadingTitle(row.title));
  let from = 0;
  headings.forEach((heading, index) => {
    const title = foldHeadingTitle(heading.title);
    if (!title) { return; }
    // A numbered outline entry ("2.1 Methods") still matches its heading.
    const at = folded.findIndex((row, rowIndex) => rowIndex >= from && (row === title || row.replace(/^[\d. ]+/, "") === title));
    if (at >= 0) { pairs.set(index, at); from = at + 1; }
  });
  return pairs;
}

type Anchor = { at: number; y: number };

/** The anchors with the body's start at height 0 and its end at `height` added around them. */
function boundAnchors(anchors: readonly Anchor[], body: { start: number; end: number }, height: number): Anchor[] {
  return [{ at: Math.min(body.start, anchors[0]?.at ?? body.start), y: 0 }, ...anchors, { at: Math.max(body.end, anchors.at(-1)?.at ?? body.end), y: height }];
}

/** Reads `to` linearly at `value` of `from` between the bounded anchors around it. */
function lerpAnchors(points: readonly Anchor[], value: number, from: "at" | "y", to: "at" | "y"): number {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    if (value <= b[from]) { return b[from] === a[from] ? a[to] : a[to] + ((value - a[from]) / (b[from] - a[from])) * (b[to] - a[to]); }
  }
  return points.at(-1)![to];
}

/** Linear between the anchors around `at`; past the ends towards `start`/`end` mapped to 0 and `height`. */
export function interpolateDocumentMap(anchors: readonly Anchor[], at: number, body: { start: number; end: number }, height: number): number {
  return lerpAnchors(boundAnchors(anchors, body, height), at, "at", "y");
}

/** The inverse of `interpolateDocumentMap`: the source order at a height. */
export function invertDocumentMap(anchors: readonly Anchor[], y: number, body: { start: number; end: number }, height: number): number {
  return lerpAnchors(boundAnchors(anchors, body, height), y, "y", "at");
}
