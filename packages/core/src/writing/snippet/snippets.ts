// Builds the snippets the editor inserts (images, tables), wraps selections, and places image files in a writing project.
import type { PathOps } from "../../path/index.js";

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

function cellRows({ columns, rows }: EmptyTableSpec): number[][] {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => row * columns + column + 1));
}

export function createTableSnippet(language: WritingLanguage, size: EmptyTableSpec): string {
  const caption = size.columns * size.rows + 1;
  const cells = cellRows(size);
  if (language === "typst") {
    return [
      "#figure(",
      "\ttable(",
      `\t\tcolumns: ${size.columns},`,
      ...cells.map((row) => `\t\t${row.map((stop) => `[\${${stop}}]`).join(", ")},`),
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
    `\t${escapeSnippetText(`\\begin{tabular}{|${"c|".repeat(size.columns)}}`)}`,
    `\t\t${rule}`,
    ...cells.flatMap((row) => [`\t\t${row.map((stop) => `\${${stop}}`).join(" & ")} ${escapeSnippetText("\\\\")}`, `\t\t${rule}`]),
    `\t${escapeSnippetText("\\end{tabular}")}`,
    `\t${escapeSnippetText("\\caption{")}\${${caption}:Caption}${escapeSnippetText("}")}`,
    `\t${escapeSnippetText("\\label{tab:")}\${${caption + 1}:label}${escapeSnippetText("}")}`,
    escapeSnippetText("\\end{table}"),
    "$0",
  ].join("\n");
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

/** True when `inner` cannot close or reopen the span that surrounds it, so the outer markers belong together. */
function isSingleSpan(language: WritingLanguage, inner: string, open: string): boolean {
  if (language === "typst") { return !inner.includes(open); }
  let depth = 0;
  for (const char of inner) {
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    if (depth < 0) { return false; }
  }
  return depth === 0;
}

export function deriveSelectionWrap(language: WritingLanguage, style: WrapKind, selected: string): WrapResult {
  const [open, close] = MARKERS[language][style];
  if (selected === "") { return { text: open + close, cursor: open.length }; }
  const wrapped = selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close);
  const inner = wrapped ? selected.slice(open.length, selected.length - close.length) : "";
  if (wrapped && isSingleSpan(language, inner, open)) { return { text: inner }; }
  return { text: open + selected + close };
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
