// Assembles the build roots a preview reader is told about: one entry per built root with its problems and what the host can open.
import {
  derivePreviewProblems,
  type BuildOptions,
  type LocatedProblem,
  type PathOps,
  type PreviewBuildRoot,
  type PreviewBuildRoots,
  type ILogger,
  type PdfProblem,
} from "@labshelf/core";
import type { ReadyProject } from "../../buildRootDocument.js";
import { rawLogFile, type RawLogDeps } from "./rawLogFile.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";

interface RootFindingsInput {
  logger?: ILogger | undefined;
  pdfProblemsOf: (root: string) => Promise<{ pdfProblems: PdfProblem[]; cites: number }>;
  wordsOf: (root: string) => Promise<number>;
}

/** A measure that fails is logged and left absent, so the root still shows the rest. */
async function attempt<T>(input: RootFindingsInput, root: string, what: string, measure: () => Promise<T>): Promise<T | undefined> {
  try {
    return await measure();
  } catch (error) {
    await input.logger?.error(PREVIEW_LOG_MODULE, error, { root, action: what });
    return undefined;
  }
}

async function rootFindings(input: RootFindingsInput, root: string): Promise<{ pdfProblems?: PdfProblem[]; cites?: number; words?: number }> {
  const [placed, words] = await Promise.all([
    attempt(input, root, "pdfProblems", () => input.pdfProblemsOf(root)),
    attempt(input, root, "words", () => input.wordsOf(root)),
  ]);
  return {
    ...(placed ? { pdfProblems: placed.pdfProblems, cites: placed.cites } : {}),
    ...(words !== undefined ? { words } : {}),
  };
}

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

async function previewRoot(input: PreviewRootsInput, root: string): Promise<PreviewBuildRoot> {
  const { paths, project } = input;
  return {
    ...(await rootFindings(input, root)),
    path: root,
    failed: input.failed(root),
    rawLog: (await rawLogFile(input, project, root)) !== undefined,
    sourceLinks: project.settings.format === "latex",
    problems: derivePreviewProblems(input.problemsOf(root), (file) => projectRelative(paths, project.folder, file)),
  };
}

export async function previewRootsMessage(input: PreviewRootsInput): Promise<PreviewBuildRoots> {
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
