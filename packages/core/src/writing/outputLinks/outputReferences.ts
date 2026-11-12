/** How a manuscript names linked copies, both ways: the text Link output inserts, and the references a scan of LaTeX and Typst text finds. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { extensionOf, posixPathOps, stemOf } from "../../path/index.js";
import { deriveOutputValuePrefix, scanTypstProjectValues } from "../project/index.js";
import { deriveOutputValueKey, FIGURE_OUTPUT_EXTENSIONS } from "./outputCopy.js";
import type { OutputFormat, OutputLink } from "./outputsFile.js";

export interface OutputReference {
  linkId: string;
  /** Character offsets of the path or key in the text. */
  start: number;
  end: number;
  /** The kept value a `\lsvalue` or a `json()` chain reads, as the link's dotted key. */
  key?: string;
}

const INCLUDEGRAPHICS = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;
const INPUT = /\\(?:input|include)\s*\{([^{}]*)\}/g;
const LSVALUE = /\\lsvalue\{([^{}\s]*)\}/g;
const TYPST_PATH = /\b(?:image|json|read)\(\s*"([^"\n]*)"|#?include\s+"([^"\n]*)"/g;

/** The project-relative paths a written path may name: from the project folder and from the manuscript's folder. */
function candidates(written: string, manuscriptPath: string): string[] {
  const trimmed = written.trim();
  if (trimmed === "") { return []; }
  if (trimmed.startsWith("/")) { return [posixPathOps.resolve(trimmed.slice(1))]; }
  const folder = posixPathOps.dirname(manuscriptPath);
  return [...new Set([posixPathOps.resolve(trimmed), posixPathOps.resolve(folder === "." ? "" : folder, trimmed)])];
}

const withoutExtension = (path: string): string => path.replace(/\.[^./]*$/, "");

function findLink(links: readonly OutputLink[], written: string, manuscriptPath: string, extensionOptional: boolean): OutputLink | undefined {
  const paths = candidates(written, manuscriptPath);
  return links.find((link) => paths.some((path) => link.copy === path || (extensionOptional && withoutExtension(link.copy) === path)));
}

/** The offset where the capture `group` of `match` starts. */
const groupStart = (match: RegExpMatchArray, group: string): number => match.index! + match[0].lastIndexOf(group);

function scanLatex(text: string, manuscriptPath: string, links: readonly OutputLink[]): OutputReference[] {
  const found: OutputReference[] = [];
  for (const pattern of [INCLUDEGRAPHICS, INPUT]) {
    for (const match of text.matchAll(pattern)) {
      const written = match[1]!;
      const link = findLink(links, written, manuscriptPath, true);
      if (link) { const start = groupStart(match, written); found.push({ linkId: link.id, start, end: start + written.length }); }
    }
  }
  const values = links.filter((link) => link.kind === "values").map((link) => ({ link, prefix: `${deriveOutputValuePrefix(link.source, link.path)}.` }));
  for (const match of text.matchAll(LSVALUE)) {
    const written = match[1]!;
    const owner = values.find(({ prefix }) => written.startsWith(prefix));
    if (owner) { const start = groupStart(match, written); found.push({ linkId: owner.link.id, start, end: start + written.length, key: written.slice(owner.prefix.length) }); }
  }
  return found;
}

function scanTypst(text: string, manuscriptPath: string, links: readonly OutputLink[]): OutputReference[] {
  const found: OutputReference[] = [];
  for (const match of text.matchAll(TYPST_PATH)) {
    const written = match[1] ?? match[2]!;
    const link = findLink(links, written, manuscriptPath, false);
    if (link) { const start = groupStart(match, `"${written}"`) + 1; found.push({ linkId: link.id, start, end: start + written.length }); }
  }
  for (const chain of scanTypstProjectValues(text)) {
    const link = findLink(links.filter((candidate) => candidate.kind === "values"), chain.source, manuscriptPath, false);
    if (link) { found.push({ linkId: link.id, start: chain.start, end: chain.end, key: chain.path }); }
  }
  return found;
}

/** Every reference to a linked copy in the text, in text order; `manuscriptPath` is the file's path relative to the project folder. */
export function scanOutputReferences(text: string, format: OutputFormat, manuscriptPath: string, links: readonly OutputLink[]): OutputReference[] {
  const found = format === "latex" ? scanLatex(text, manuscriptPath, links) : scanTypst(text, manuscriptPath, links);
  return found.sort((a, b) => a.start - b.start);
}

// --- The inserted text ---

export interface OutputInsert {
  text: string;
  /** True when the text goes on lines of its own; values go inline at the cursor. */
  block: boolean;
}

const LABEL_CHARACTERS = /[^A-Za-z0-9:_-]+/g;

/**
 * What Link output inserts for a link. A Typst manuscript outside the project root names the copy from the root (`/outputs/…`), as Typst
 * resolves a path from the file's folder. `keys` are the values to insert, all of the link's when absent.
 */
export function buildOutputInsert(link: OutputLink, format: OutputFormat, manuscriptPath = "", keys?: readonly string[]): OutputInsert {
  const copy = format === "typst" && manuscriptPath.includes("/") ? `/${link.copy}` : link.copy;
  const extension = extensionOf(link.copy);
  const withoutTex = extension === ".tex" ? copy.slice(0, -".tex".length) : copy;
  if (link.kind === "values") {
    const picked = keys ?? link.keys ?? [];
    const text = format === "latex"
      ? picked.map((key) => `\\lsvalue{${deriveOutputValueKey(link, key)}}`).join(" ")
      : picked.map((key) => `#json("${copy}").${key}`).join(" ");
    return { text, block: false };
  }
  if (link.kind === "file" && FIGURE_OUTPUT_EXTENSIONS.includes(extension)) {
    const label = `fig:${stemOf(link.copy).replace(LABEL_CHARACTERS, "-")}`;
    const text = format === "latex"
      ? `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=\\linewidth]{${copy}}\n  \\caption{}\n  \\label{${label}}\n\\end{figure}`
      : `#figure(image("${copy}", width: 100%), caption: [])`;
    return { text, block: true };
  }
  if (format === "latex") { return { text: `\\input{${withoutTex}}`, block: true }; }
  return { text: extension === ".typ" ? `#include "${copy}"` : `#raw(read("${copy}"))`, block: true };
}

/** Whether a LaTeX preamble loads booktabs, which a linked table's rules need. */
export const loadsBooktabs = (text: string): boolean => /^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\bbooktabs\b[^}]*\}/m.test(text);
