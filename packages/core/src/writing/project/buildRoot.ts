/** Finds what a project builds: its format and main file from the sources at its root, every file that builds to a PDF of its own (LaTeX by \documentclass, Typst by the include graph), the root a save builds and the build folder name of each. */

import { extensionOf, isInside } from "../../path/index.js";
import { resolveTypstPath } from "../../typst/language/index.js";
import type { ProjectFormat } from "./projectFile.js";
import { listProjectFiles, type ProjectReadContext } from "./projectReads.js";

// --- Main file and format ---

const EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };
const CONVENTIONAL_MAIN: Record<ProjectFormat, string> = { latex: "main.tex", typst: "main.typ" };

// A commented-out `% \documentclass` does not count: the line must start with the command.
const DOCUMENT_CLASS = /^[ \t]*\\documentclass\b/m;

/** Source files of the format, the conventional main name first, then alphabetical. */
export function findEntryCandidates(format: ProjectFormat, fileNames: readonly string[]): string[] {
  const main = CONVENTIONAL_MAIN[format];
  return fileNames
    .filter((name) => name.toLowerCase().endsWith(EXTENSION[format]))
    .sort((a, b) => Number(b === main) - Number(a === main) || a.localeCompare(b));
}

/**
 * LaTeX: the first candidate that declares `\documentclass`. Typst has no such marker, so only `main.typ` is taken.
 * @returns undefined when nothing qualifies; the user then picks the main by hand
 */
export async function detectEntryFile(
  format: ProjectFormat,
  fileNames: readonly string[],
  readText: (name: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (format === "typst") { return fileNames.includes(CONVENTIONAL_MAIN.typst) ? CONVENTIONAL_MAIN.typst : undefined; }
  for (const name of findEntryCandidates(format, fileNames)) {
    const text = await readText(name);
    if (text !== undefined && DOCUMENT_CLASS.test(text)) { return name; }
  }
  return undefined;
}

/** The format a folder's sources suggest: LaTeX wins when both kinds are present; undefined when neither is. */
export function detectFormat(fileNames: readonly string[]): ProjectFormat | undefined {
  if (findEntryCandidates("latex", fileNames).length > 0) { return "latex"; }
  if (findEntryCandidates("typst", fileNames).length > 0) { return "typst"; }
  return undefined;
}

// --- Root files ---

export interface BuildRootCandidate { readonly path: string; readonly text: string }

// Group 1 is "#" or empty (a bare keyword only counts when a string follows, so prose "import data" is ignored);
// group 2 is a string-literal target; group 3 marks a literal that is part of a `+` concatenation.
const TYPST_REFERENCE = /(#?)\b(?:include|import)\s+(?:"((?:[^"\\\n]|\\.)*)"(\s*\+)?|(?=[\w(]))/g;
// TRAP: the lookbehind keeps `https://` inside strings from being cut as a line comment.
const TYPST_COMMENT = /\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm;

function isLatexRoot(text: string): boolean {
  const end = text.indexOf("\\begin{document}");
  return DOCUMENT_CLASS.test(end < 0 ? text : text.slice(0, end));
}

interface TypstReferences { readonly targets: Set<string>; readonly computed: boolean }

function typstReferences(file: BuildRootCandidate): TypstReferences {
  const targets = new Set<string>();
  let computed = false;
  for (const match of file.text.replace(TYPST_COMMENT, "").matchAll(TYPST_REFERENCE)) {
    const [, hash, literal, concatenated] = match;
    if (literal === undefined) {
      if (hash === "#") { computed = true; }
      continue;
    }
    if (concatenated) { computed = true; continue; }
    if (literal.startsWith("@")) { continue; }
    const resolved = resolveTypstPath(file.path, literal);
    if (resolved !== undefined && resolved !== file.path) { targets.add(resolved); }
  }
  return { targets, computed };
}

/** Typst roots are the files no other file includes. A computed path cannot be followed, so it makes every other Typst file a non-root. */
function typstRoots(files: readonly BuildRootCandidate[]): Set<string> {
  const included = new Set<string>();
  const computing: string[] = [];
  for (const file of files) {
    const { targets, computed } = typstReferences(file);
    targets.forEach((target) => included.add(target));
    if (computed) { computing.push(file.path); }
  }
  return new Set(files
    .filter((file) => !included.has(file.path) && computing.every((path) => path === file.path))
    .map((file) => file.path));
}

/** Root files of the project in input order; sources that are neither .tex nor .typ are never roots. */
export function findBuildRoots(sources: readonly BuildRootCandidate[]): string[] {
  const typstFiles = sources.filter((file) => extensionOf(file.path) === ".typ");
  const typst = typstRoots(typstFiles);
  return sources
    .filter((file) => {
      const extension = extensionOf(file.path);
      return extension === ".tex" ? isLatexRoot(file.text) : extension === ".typ" && typst.has(file.path);
    })
    .map((file) => file.path);
}

// --- Build folder of a root ---

// Roots with the same basename in different folders must not share auxiliary files.
export function deriveBuildRootFolder(root: string): string {
  return root.replaceAll("/", "__");
}

// --- The root a save builds ---

const SOURCE_EXTENSION = /\.(tex|typ)$/i;

type RootReads = Pick<ProjectReadContext, "fs" | "paths">;

async function readSource({ fs }: RootReads, absolute: string, relative: string): Promise<{ path: string; text: string } | undefined> {
  try {
    return { path: relative, text: await fs.readText(absolute) };
  } catch {
    return undefined; // an unreadable file cannot be a root
  }
}

/** Project-relative posix root a save of `file` (absolute) builds. */
export async function buildRootOf(reads: RootReads, projectFolder: string, main: string, file: string): Promise<string> {
  const { paths } = reads;
  const relative = paths.relative(projectFolder, file).split(paths.sep).join("/");
  if (!isInside(paths, projectFolder, file) || !SOURCE_EXTENSION.test(relative)) { return main; }
  const relatives = (await listProjectFiles(reads, projectFolder)).filter((candidate) => SOURCE_EXTENSION.test(candidate));
  const sources = await Promise.all(relatives.map((candidate) => readSource(reads, paths.join(projectFolder, candidate), candidate)));
  const roots = findBuildRoots(sources.filter((source) => source !== undefined));
  return roots.includes(relative) ? relative : main;
}
