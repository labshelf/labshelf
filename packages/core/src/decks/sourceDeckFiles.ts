// The files of a multi-file LaTeX or Typst talk: the includes found between slides, their project-relative paths, the block tree that
// follows them with each included node carrying its file, and the path comparison hosts use for SyncTeX inputs.
import { normalizeInputPath } from "../writing/synctexFile.js";
import type { DeckKind } from "./deckSizes.js";
import { readSourceDeckBlocks } from "./sourceDeckBlocks.js";
import type { SourceDeckNode, SourceDeckRange } from "./sourceDeckBlocks.js";
import { blank } from "./sourceDeckScan.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** An include between slides: the project-relative path it names and the range of the include command in its file. */
export interface SourceDeckInclude { path: string; range: SourceDeckRange }

/**
 * The project-relative posix path an include names. LaTeX resolves against the folder of `fromFile` (callers pass the main file, TeX's
 * working folder) and adds `.tex` to a name without an extension; Typst resolves against the including file's folder as written.
 * Undefined for an absolute path, a path holding a macro (`\` or `#`) or one that leaves the project root.
 */
export function resolveSourceDeckInclude(format: SourceDeckFormat, fromFile: string, written: string): string | undefined {
  const path = written.trim();
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || /[\\#]/.test(path)) return undefined;
  const parts = fromFile.split("/").slice(0, -1).filter((part) => part !== "" && part !== ".");
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return undefined;
  }
  const name = parts.pop();
  if (name === undefined) return undefined;
  return [...parts, format === "latex" && !name.includes(".") ? `${name}.tex` : name].join("/");
}

const LATEX_INCLUDE = /\\(?:input|include|subfile)(?![A-Za-z@])\s*\{([^{}]*)\}/g;
const TYPST_INCLUDE = /^([ \t]*)#include[ \t]+"([^"\n]*)"/gm;

/** The slides an include must stand outside: every frame, every call-style Typst slide (a heading slide's section does not count). */
const enclosing = (format: SourceDeckFormat, text: string, slides: readonly SourceDeckNode[]): SourceDeckRange[] =>
  slides.filter((node) => node.kind === "slide" && (format === "latex" || text[node.range[0]] === "#")).map((node) => node.range);

function includesBetween(format: SourceDeckFormat, file: string, text: string, slides: readonly SourceDeckNode[]): SourceDeckInclude[] {
  const code = blank(format, text);
  const inside = enclosing(format, text, slides);
  const found: SourceDeckInclude[] = [];
  const re = new RegExp(format === "latex" ? LATEX_INCLUDE : TYPST_INCLUDE);
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const start = format === "latex" ? m.index : m.index + m[1]!.length;
    const range: SourceDeckRange = [start, m.index + m[0].length];
    if (inside.some(([from, to]) => start >= from && start < to)) continue;
    const path = resolveSourceDeckInclude(format, file, format === "latex" ? m[1]! : m[2]!);
    if (path !== undefined) found.push({ path, range });
  }
  return found;
}

/**
 * The includes of one talk file that stand between slides, in order: LaTeX `\input`, `\include` and `\subfile` outside comments and
 * frames, Typst line-level `#include "…"` outside call-style slides. Unresolvable paths are skipped.
 */
export function readSourceDeckIncludes(format: SourceDeckFormat, file: string, text: string): SourceDeckInclude[] {
  return includesBetween(format, file, text, readSourceDeckBlocks(format, "talk", text));
}

function markFile(nodes: readonly SourceDeckNode[], file: string): void {
  for (const node of nodes) { node.file = file; if (node.children) markFile(node.children, file); }
}

/**
 * The block tree of a talk across its files: the main file's slides with, at each include between slides, the slides of the included
 * file read recursively, each of their nodes carrying `file`. A file contributes once, at its first include; an unreadable one is
 * skipped. Posters follow no includes. Nodes of the main file carry no `file` key.
 */
export function readSourceDeckProject(format: SourceDeckFormat, kind: DeckKind, mainPath: string, read: (path: string) => string | undefined): SourceDeckNode[] {
  const main = read(mainPath);
  if (main === undefined) return [];
  if (kind !== "talk") return readSourceDeckBlocks(format, kind, main);
  const seen = new Set([mainPath]);
  const tree = (path: string, text: string): SourceDeckNode[] => {
    const nodes = readSourceDeckBlocks(format, "talk", text);
    if (path !== mainPath) markFile(nodes, path);
    const placed: SourceDeckNode[][] = nodes.map(() => []); const tail: SourceDeckNode[] = [];
    for (const include of includesBetween(format, format === "latex" ? mainPath : path, text, nodes)) {
      if (seen.has(include.path)) continue;
      seen.add(include.path);
      const included = read(include.path);
      if (included === undefined) continue;
      const before = nodes.findIndex((node) => node.range[0] >= include.range[0]);
      (before === -1 ? tail : placed[before]!).push(...tree(include.path, included));
    }
    return [...nodes.flatMap((node, index) => [...placed[index]!, node]), ...tail];
  };
  return tree(mainPath, main);
}

/** Whether two SyncTeX input paths name the same file, both resolved against `cwd`; case-insensitive only between drive-letter paths. */
export function sameSourcePath(a: string, b: string, cwd: string): boolean {
  const left = normalizeInputPath(a, cwd); const right = normalizeInputPath(b, cwd);
  const drive = /^[a-z]:\//;
  return drive.test(left) && drive.test(right) ? left.toLowerCase() === right.toLowerCase() : left === right;
}
