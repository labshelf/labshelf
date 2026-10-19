// Assembles the build roots a preview reader is told about: one entry per built root with its problems and what the host can open.
import { previewProblems, type BuildOptions, type LocatedProblem, type PathOps, type PreviewRoot, type PreviewRoots } from "@labshelf/core";
import type { ReadyProject } from "../../mainDocument.js";
import { rawLogFile, type RawLogDeps } from "./rawLogFile.js";
import { rootFindings, type RootFindingsInput } from "./rootFindings.js";

export interface PreviewRootsInput extends RawLogDeps, RootFindingsInput {
  project: ReadyProject;
  /** The roots built so far, in build order. */
  built: Iterable<string>;
  focused: string;
  shown: string;
  problemsOf: (root: string) => readonly LocatedProblem[];
  failed: (root: string) => boolean;
  options?: BuildOptions;
  /** Findings of the last pre-submission check. */
  checks?: number;
}

function projectRelative(paths: PathOps, folder: string, file: string): string {
  const relative = paths.relative(folder, file);
  return (relative.startsWith("..") || paths.isAbsolute(relative) ? file : relative).split(paths.sep).join("/");
}

async function previewRoot(input: PreviewRootsInput, root: string): Promise<PreviewRoot> {
  const { paths, project } = input;
  return {
    ...(await rootFindings(input, root)),
    path: root,
    failed: input.failed(root),
    rawLog: (await rawLogFile(input, project, root)) !== undefined,
    sourceLinks: project.settings.format === "latex",
    problems: previewProblems(input.problemsOf(root), (file) => projectRelative(paths, project.folder, file)),
  };
}

export async function previewRootsMessage(input: PreviewRootsInput): Promise<PreviewRoots> {
  const roots = await Promise.all([...input.built].map((root) => previewRoot(input, root)));
  const { pages: pageLimit, words: wordLimit, countUpTo } = input.project.settings.check ?? {};
  return {
    main: input.project.main ?? input.shown, focused: input.focused, shown: input.shown, roots,
    ...(pageLimit !== undefined ? { pageLimit } : {}),
    ...(wordLimit !== undefined ? { wordLimit } : {}),
    ...(countUpTo !== undefined ? { countUpTo } : {}),
    ...(input.checks !== undefined ? { checks: input.checks } : {}),
    ...(input.options ? { options: input.options } : {}),
  };
}
