/** Reads a LaTeX project's source files: the include tree, undefined references and MathJax macros. */
import type { LatexInclude, LatexRange, LatexSourceFacts, MacroFact, ReferenceFact } from "./source.js";
import { scanLatexSource } from "./source.js";

/** Reads project files; the host answers from open editors first, then the disk. */
export interface ProjectSourceReader {
  /** The text of a project-root-relative posix path, or undefined when the file does not exist. */
  read(relativePath: string): Promise<string | undefined>;
}

export interface ProjectSourceFile {
  path: string;
  facts: LatexSourceFacts;
}

export interface MissingSource {
  /** The project-root-relative path that was looked up, or the path as written when it cannot be resolved. */
  path: string;
  /** The include that points at it; undefined when the main file itself is missing. */
  includedFrom: { file: string; range: LatexRange } | undefined;
}

export interface ProjectSources {
  /** The main file first, then each included file depth-first in the order its include appears. */
  files: ProjectSourceFile[];
  missing: MissingSource[];
}

/** A file reached twice, through a cycle or two includes, is read and listed once. */
export async function readLatexProjectSources(mainPath: string, reader: ProjectSourceReader): Promise<ProjectSources> {
  const result: ProjectSources = { files: [], missing: [] };
  const visited = new Set<string>();
  const visit = async (path: string, includedFrom: MissingSource["includedFrom"]): Promise<void> => {
    if (visited.has(path)) { return; }
    visited.add(path);
    const text = await reader.read(path);
    if (text === undefined) {
      result.missing.push({ path, includedFrom });
      return;
    }
    const facts = scanLatexSource(text);
    result.files.push({ path, facts });
    for (const include of facts.includes) { await visitInclude(path, include); }
  };
  const visitInclude = async (from: string, include: LatexInclude): Promise<void> => {
    const target = resolveIncludePath(include.path);
    const origin = { file: from, range: include.range };
    if (target === undefined) { result.missing.push({ path: include.path, includedFrom: origin }); }
    else { await visit(target, origin); }
  };
  await visit(mainPath, undefined);
  return result;
}

/**
 * LaTeX resolves include paths from the directory TeX runs in, which is the project root,
 * so the including file's folder plays no part. Returns undefined for a path that is absolute,
 * leaves the project, or holds macros and so cannot be known statically.
 */
export function resolveIncludePath(path: string): string | undefined {
  if (path.startsWith("/") || /[\\#{}$]/.test(path)) { return undefined; }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") { continue; }
    if (part === "..") {
      if (parts.pop() === undefined) { return undefined; }
    } else { parts.push(part); }
  }
  const name = parts.pop();
  if (name === undefined) { return undefined; }
  return [...parts, name.includes(".") ? name : `${name}.tex`].join("/");
}

export interface UndefinedReference {
  /** The file holding the reference. */
  path: string;
  ref: ReferenceFact;
}

// TRAP: a label that lives in an unscanned file, such as one pulled in by `\externaldocument`, is reported as undefined.
export function findUndefinedReferences(files: readonly ProjectSourceFile[]): UndefinedReference[] {
  const labels = new Set(files.flatMap((file) => file.facts.labels.map((label) => label.name)));
  return files.flatMap((file) => file.facts.refs.filter((ref) => !labels.has(ref.name)).map((ref) => ({ path: file.path, ref })));
}

export type MathJaxMacros = Record<string, string | [string, number] | [string, number, string]>;

/** Later definitions replace earlier ones; `\providecommand` never replaces an existing definition. */
export function deriveMathJaxMacros(macros: readonly MacroFact[]): MathJaxMacros {
  const result: MathJaxMacros = {};
  for (const macro of macros) {
    if (macro.command === "providecommand" && macro.name in result) { continue; }
    if (macro.defaultArg !== undefined) { result[macro.name] = [macro.body, macro.argCount, macro.defaultArg]; }
    else if (macro.argCount > 0) { result[macro.name] = [macro.body, macro.argCount]; }
    else { result[macro.name] = macro.body; }
  }
  return result;
}
