// Builds the snippets the editor inserts (images, tables), wraps selections, and places image files in a writing project.
import type { PathOps } from "../path/index.js";

type WritingLanguage = "latex" | "typst";

/** Escapes literal text for TextMate snippet syntax, which VS Code and Monaco both read. */
function escapeSnippetText(text: string): string {
  return text.replace(/[\\$}]/g, (char) => `\\${char}`);
}

/** @param imagePath The image path as the compiler resolves it, with "/" separators. */
export function createImageSnippet(language: WritingLanguage, imagePath: string): string {
  if (language === "typst") {
    const quoted = JSON.stringify(imagePath);
    return [
      "#figure(",
      `\timage(${escapeSnippetText(quoted)}, width: 80%),`,
      "\tcaption: [${1:Caption}],",
      ") <fig:${2:label}>",
      "$0",
    ].join("\n");
  }
  return [
    escapeSnippetText("\\begin{figure}[h]"),
    `\t${escapeSnippetText("\\centering")}`,
    `\t${escapeSnippetText(`\\includegraphics[width=0.8\\linewidth]{${imagePath}}`)}`,
    `\t${escapeSnippetText("\\caption{")}\${1:Caption}${escapeSnippetText("}")}`,
    `\t${escapeSnippetText("\\label{fig:")}\${2:label}${escapeSnippetText("}")}`,
    escapeSnippetText("\\end{figure}"),
    "$0",
  ].join("\n");
}

export interface EmptyTableSpec {
  columns: number;
  rows: number;
}

export const MAX_TABLE_SIDE = 20;

/** Reads "3x2" (columns x rows; "×" and spaces allowed); undefined when it is not a size within the limit. */
export function parseTableSize(input: string): EmptyTableSpec | undefined {
  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(input);
  if (!match) { return undefined; }
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  const fits = (side: number): boolean => side >= 1 && side <= MAX_TABLE_SIDE;
  return fits(columns) && fits(rows) ? { columns, rows } : undefined;
}

/** An empty table of the size: every cell a tab stop, then the caption and label. */
export function createTableSnippet(language: WritingLanguage, { columns, rows }: EmptyTableSpec): string {
  return createFilledTableSnippet(language, { cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => "")), header: false });
}

/** A table the user filled in: its rows of cell text, and whether the first row is a header. Empty cells become tab stops. */
export interface FilledTableSpec {
  cells: readonly (readonly string[])[];
  header: boolean;
}

/** LaTeX text for a cell: &, %, # and, outside $…$, _ escaped, so data from a CSV compiles; math between $ is left as typed. */
function escapeLatexCell(text: string): string {
  return text.split("$").map((part, i) => (i % 2 === 1 ? part : part.replace(/(?<!\\)[&%#]/g, (c) => `\\${c}`).replace(/(?<!\\)_/g, "\\_"))).join("$");
}

/** Typst content for a cell: the brackets and # that would end or script it escaped. */
const escapeTypstCell = (text: string): string => text.replace(/[[\]#]/g, (c) => `\\${c}`);

/** The table snippet with the user's cells: a filled cell is its text, an empty one a tab stop, then the caption and label. */
export function createFilledTableSnippet(language: WritingLanguage, { cells, header }: FilledTableSpec): string {
  let stop = 0;
  const columns = Math.max(1, ...cells.map((row) => row.length));
  const cell = (text: string | undefined, bold: boolean): string => {
    const trimmed = (text ?? "").trim();
    if (trimmed === "") return `\${${++stop}}`;
    const body = escapeSnippetText(language === "typst" ? escapeTypstCell(trimmed) : escapeLatexCell(trimmed));
    if (!bold) return body;
    return language === "typst" ? `*${body}*` : `${escapeSnippetText("\\textbf{")}${body}${escapeSnippetText("}")}`;
  };
  const rows = cells.map((row, r) => Array.from({ length: columns }, (_, c) => cell(row[c], header && r === 0)));
  const caption = ++stop;
  if (language === "typst") {
    return [
      "#figure(",
      "\ttable(",
      `\t\tcolumns: ${columns},`,
      ...rows.map((row, r) => (header && r === 0 ? `\t\ttable.header(${row.map((c) => `[${c}]`).join(", ")}),` : `\t\t${row.map((c) => `[${c}]`).join(", ")},`)),
      "\t),",
      `\tcaption: [\${${caption}:Caption}],`,
      `) <tab:\${${caption + 1}:label}>`,
      "$0",
    ].join("\n");
  }
  const rule = escapeSnippetText("\\hline");
  return [
    escapeSnippetText("\\begin{table}[h]"),
    `\t${escapeSnippetText("\\centering")}`,
    `\t${escapeSnippetText(`\\begin{tabular}{|${"c|".repeat(columns)}}`)}`,
    `\t\t${rule}`,
    ...rows.flatMap((row) => [`\t\t${row.join(" & ")} ${escapeSnippetText("\\\\")}`, `\t\t${rule}`]),
    `\t${escapeSnippetText("\\end{tabular}")}`,
    `\t${escapeSnippetText("\\caption{")}\${${caption}:Caption}${escapeSnippetText("}")}`,
    `\t${escapeSnippetText("\\label{tab:")}\${${caption + 1}:label}${escapeSnippetText("}")}`,
    escapeSnippetText("\\end{table}"),
    "$0",
  ].join("\n");
}

/**
 * Reads CSV text (also ; or tab separated, picked from the first line) into rows of cells: quoted fields may hold the
 * separator, newlines and doubled quotes. Trailing empty lines are dropped.
 */
export function parseDelimitedTable(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (sep: string): number => firstLine.split(sep).length - 1;
  const separator = ["\t", ";", ","].reduce((best, sep) => (count(sep) > count(best) ? sep : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === separator) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell.trim() === "")) rows.pop();
  return rows;
}

export type WrapKind = "bold" | "italic";

export interface WrapResult {
  text: string;
  /** Offset in `text` where the cursor goes; set only when the selection was empty. */
  cursor?: number;
}

const MARKERS: Record<WritingLanguage, Record<WrapKind, readonly [string, string]>> = {
  latex: { bold: ["\\textbf{", "}"], italic: ["\\emph{", "}"] },
  typst: { bold: ["*", "*"], italic: ["_", "_"] },
};

/** A pair of markers a selection is wrapped in; `pair` names the brackets that must balance inside a span, and without it the inner text must not hold `open`. */
export interface WrapMarkers {
  open: string;
  close: string;
  pair?: readonly [string, string];
}

/** True when `inner` cannot close or reopen the span that surrounds it, so the outer markers belong together. */
function isSingleSpan({ open, pair }: WrapMarkers, inner: string): boolean {
  if (!pair) { return !inner.includes(open); }
  let depth = 0;
  for (const char of inner) {
    depth += char === pair[0] ? 1 : char === pair[1] ? -1 : 0;
    if (depth < 0) { return false; }
  }
  return depth === 0;
}

/** Wraps `selected` in the markers, or unwraps it when it already is one span of them; an empty selection gets an empty pair with the cursor inside. */
export function deriveMarkerWrap(markers: WrapMarkers, selected: string): WrapResult {
  const { open, close } = markers;
  if (selected === "") { return { text: open + close, cursor: open.length }; }
  const wrapped = selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close);
  const inner = wrapped ? selected.slice(open.length, selected.length - close.length) : "";
  if (wrapped && isSingleSpan(markers, inner)) { return { text: inner }; }
  return { text: open + selected + close };
}

export function deriveSelectionWrap(language: WritingLanguage, style: WrapKind, selected: string): WrapResult {
  const [open, close] = MARKERS[language][style];
  return deriveMarkerWrap({ open, close, ...(language === "latex" && { pair: ["{", "}"] as const }) }, selected);
}

export const IMAGE_FOLDER = "images";

export const IMAGE_EXTENSIONS: Record<WritingLanguage, string[]> = {
  latex: ["png", "jpg", "jpeg", "pdf", "eps"],
  typst: ["png", "jpg", "jpeg", "gif", "svg"],
};

/** The first path in `folder` for `deriveFileName` that does not exist: `stem.ext`, `stem-2.ext`, `stem-3.ext`, ... */
export async function findFreeImageName(
  paths: Pick<PathOps, "join" | "extname" | "basename">,
  folder: string,
  fileName: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  const extension = paths.extname(fileName);
  const stem = paths.basename(fileName, extension);
  let target = paths.join(folder, stem + extension);
  for (let suffix = 2; await exists(target); suffix += 1) {
    target = paths.join(folder, `${stem}-${suffix}${extension}`);
  }
  return target;
}

/** LaTeX resolves graphics from the main file's folder; Typst from the folder of the file that names the image. */
export function deriveImageBaseFolder(
  language: WritingLanguage,
  projectFolder: string,
  main: string | undefined,
  documentPath: string,
  paths: Pick<PathOps, "join" | "dirname">,
): string {
  if (language === "latex" && main) { return paths.dirname(paths.join(projectFolder, main)); }
  return paths.dirname(documentPath);
}
