// Assembles the build roots a preview reader is told about: one entry per built root with its problems and what the host can open.
import type { LocatedProblem, PathOps, PreviewRoot, PreviewRoots } from "@labshelf/core";
import type { ReadyProject } from "../../mainDocument.js";
import { rawLogFile, type RawLogDeps } from "./rawLogFile.js";

export interface PreviewRootsInput extends RawLogDeps {
  project: ReadyProject;
  /** The roots built so far, in build order. */
  built: Iterable<string>;
  focused: string;
  shown: string;
  problemsOf: (root: string) => readonly LocatedProblem[];
  failed: (root: string) => boolean;
}

function projectRelative(paths: PathOps, folder: string, file: string): string {
  const relative = paths.relative(folder, file);
  return (relative.startsWith("..") || paths.isAbsolute(relative) ? file : relative).split(paths.sep).join("/");
}

async function previewRoot(input: PreviewRootsInput, root: string): Promise<PreviewRoot> {
  const { paths, project } = input;
  return {
    path: root,
    failed: input.failed(root),
    rawLog: (await rawLogFile(input, project, root)) !== undefined,
    sourceLinks: project.settings.format === "latex",
    problems: input.problemsOf(root).map((problem) => ({
      severity: problem.severity,
      message: problem.message,
      ...(problem.hint ? { hint: problem.hint } : {}),
      ...(problem.file ? { file: projectRelative(paths, project.folder, problem.file) } : {}),
      ...(problem.line !== undefined ? { line: problem.line } : {}),
    })),
  };
}

export async function previewRootsMessage(input: PreviewRootsInput): Promise<PreviewRoots> {
  const roots = await Promise.all([...input.built].map((root) => previewRoot(input, root)));
  return { main: input.project.main ?? input.shown, focused: input.focused, shown: input.shown, roots };
}
