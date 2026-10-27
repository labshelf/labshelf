/** Finds the files of a project that build to a PDF of their own: LaTeX by \documentclass, Typst by the include graph. */

import { extensionOf } from "../../../path/index.js";
import { resolveTypstPath } from "../../../typst/language/project/index.js";
import { DOCUMENT_CLASS } from "./entryDetection.js";

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
