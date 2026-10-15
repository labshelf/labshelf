/** Reads a LaTeX project's main file and every file it includes, scanning each once in tree order. */
import type { IncludeFact, LatexRange, LatexSourceFacts } from "../facts.js";
import { scanLatexSource } from "../scan/index.js";
import { resolveIncludePath } from "./resolveIncludePath.js";

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
export async function collectProjectSources(mainPath: string, reader: ProjectSourceReader): Promise<ProjectSources> {
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
  const visitInclude = async (from: string, include: IncludeFact): Promise<void> => {
    const target = resolveIncludePath(include.path);
    const origin = { file: from, range: include.range };
    if (target === undefined) { result.missing.push({ path: include.path, includedFrom: origin }); }
    else { await visit(target, origin); }
  };
  await visit(mainPath, undefined);
  return result;
}
