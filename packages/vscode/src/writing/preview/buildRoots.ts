// Tells an open preview about a project's build roots: their problems, raw logs, sources, preprints and last builds, and answers the reader's writing actions.
import * as vscode from "vscode";

import {
  checkBibliography,
  deriveBuildRootFolder,
  derivePreviewProblems,
  isInside,
  lineAt,
  readLatexProjectSources,
  type BuildOptions,
  type BuildState,
  type ILogger,
  type LocatedProblem,
  type PathOps,
  type PdfProblem,
  type PreviewBuildRoot,
  type PreviewBuildRoots,
  type PreviewPorts,
  type ProjectContentPort,
  type ProjectSourceReader,
  type PublishedVersionFinder,
  type TypstCitation,
} from "@labshelf/core";
import type { FinishedBuild } from "../build/index.js";
import { deriveProjectPath, type ReadyProject } from "../projects/index.js";
import type { BuildRootOf } from "../projects/index.js";
import { listUserBibliographyFiles } from "./citationFixes.js";
import { PREVIEW_LOG_MODULE } from "./panel.js";
import { openSourceLine } from "./synctex.js";

export interface RawLogDeps {
  paths: PathOps;
  data: Pick<ProjectContentPort, "projectBuildDir">;
}

/** The `.log` path of the root, or `undefined` for Typst (it has no log) and when the file does not exist. */
export async function readRawLogFile(deps: RawLogDeps, project: ReadyProject, root: string): Promise<string | undefined> {
  if (project.settings.format !== "latex") { return undefined; }
  const { paths } = deps;
  const base = paths.basename(root).replace(/\.[^/.]*$/, "");
  const file = paths.join(deps.data.projectBuildDir(project.settings.id), deriveBuildRootFolder(root), `${base}.log`);
  return await vscode.workspace.fs.stat(vscode.Uri.file(file)).then(() => file, () => undefined);
}

/** The active editor, or `undefined` when there is none or its file is not inside the project folder. */
export function readActiveProjectEditor(paths: PathOps, folder: string): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri;
  return editor && uri?.scheme === "file" && isInside(paths, folder, uri.fsPath) ? editor : undefined;
}

/** The root the active project editor builds into; the project's main root when no project file is active. */
export async function readFocusedBuildRoot(paths: PathOps, buildRootOf: BuildRootOf, project: ReadyProject): Promise<string> {
  const main = project.main ?? "";
  const editor = readActiveProjectEditor(paths, project.folder);
  return editor ? await buildRootOf(project.folder, main, editor.document.uri.fsPath) : main;
}

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

export interface PreviewBuildRootsInput extends RawLogDeps, RootFindingsInput {
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

async function previewRoot(input: PreviewBuildRootsInput, root: string): Promise<PreviewBuildRoot> {
  const { paths, project } = input;
  return {
    ...(await rootFindings(input, root)),
    path: root,
    failed: input.failed(root),
    rawLog: (await readRawLogFile(input, project, root)) !== undefined,
    sourceLinks: project.settings.format === "latex",
    problems: derivePreviewProblems(input.problemsOf(root), (file) => deriveProjectPath(paths, project.folder, file)),
  };
}

export async function createPreviewBuildRootsMessage(input: PreviewBuildRootsInput): Promise<PreviewBuildRoots> {
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

export interface ProjectPreprintsDeps {
  /** The library root, and with it the logger, can change after activation. */
  logger: () => ILogger | undefined;
  lookup: PublishedVersionFinder;
}

type Preprint = { key: string; message: string; file?: string; line?: number };

export function createProjectPreprints(deps: ProjectPreprintsDeps): (project: ReadyProject) => Promise<Preprint[]> {
  return async (project) => {
    try {
      const preprints: Preprint[] = [];
      for (const document of await listUserBibliographyFiles(project.folder)) {
        const text = document.getText();
        for (const finding of await checkBibliography(text, deps.lookup)) {
          if (finding.rule !== "published-version") { continue; }
          preprints.push({ key: finding.key, message: finding.message, file: document.uri.fsPath, line: lineAt(text, finding.start) });
        }
      }
      return preprints;
    } catch (error) {
      await deps.logger()?.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, action: "preprints" });
      return [];
    }
  };
}

/** `root` is the project-relative path of the root file; a file that cannot be read is left out. */
export function createProjectSources(
  readerFor: (folder: string) => ProjectSourceReader,
): (project: ReadyProject, root: string) => Promise<{ file: string; text: string }[]> {
  return async (project, root) => {
    const reader = readerFor(project.folder);
    // Typst includes are not followed, so its root counts as its own file.
    const files = project.settings.format === "typst"
      ? [root]
      : (await readLatexProjectSources(root, reader)).files.map((file) => file.path);
    const sources: { file: string; text: string }[] = [];
    for (const file of files) {
      const text = await reader.read(file);
      if (text !== undefined) { sources.push({ file, text }); }
    }
    return sources;
  };
}

export type WritingActions = Pick<PreviewPorts, "recompile" | "revealCursor" | "openProblem" | "openRawLog">;

export interface WritingActionsDeps extends RawLogDeps {
  logger: ILogger;
  project: ReadyProject;
  shownRoot: () => string;
  recompile: (projectFolder: string, root: string) => Promise<unknown>;
  /** The problems of a root the host reported, or `undefined` for any other root. */
  problemsOf: (root: string) => readonly LocatedProblem[] | undefined;
  /** Scrolls the preview to the output of a source line (1-based). */
  reveal: (file: string, line: number) => Promise<void>;
}

const NO_EDITOR_MESSAGE = "Open a file of this project to show its cursor in the preview.";
const NO_RAW_LOG_MESSAGE = "This build kept no raw log.";

// Opens a file at a line; a failure is logged and shown, since the reader that asked has no way to report it.
async function openOrReport(deps: WritingActionsDeps, file: string, line: number, context: Record<string, unknown>): Promise<boolean> {
  try {
    await openSourceLine(file, line);
    return true;
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: deps.project.folder, file, line, ...context });
    void vscode.window.showErrorMessage(`Could not open ${deps.paths.basename(file)}.`);
    return false;
  }
}

async function revealCursor(deps: WritingActionsDeps): Promise<void> {
  const editor = readActiveProjectEditor(deps.paths, deps.project.folder);
  if (!editor) {
    await vscode.window.showInformationMessage(NO_EDITOR_MESSAGE);
    return;
  }
  await deps.reveal(editor.document.uri.fsPath, editor.selection.active.line + 1);
}

async function openProblem(deps: WritingActionsDeps, root: string, index: number): Promise<void> {
  const { logger, project } = deps;
  const problem = deps.problemsOf(root)?.[index];
  if (!problem?.file) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No source to open for the problem", { projectFolder: project.folder, root, index });
    return;
  }
  const line = problem.line ?? 1;
  if (!await openOrReport(deps, problem.file, line, { root, index })) { return; }
  await logger.log("INFO", PREVIEW_LOG_MODULE, "Opened build problem", { projectFolder: project.folder, root, file: problem.file, line });
}

async function openRawLog(deps: WritingActionsDeps, root: string): Promise<void> {
  const { logger, project } = deps;
  if (!deps.problemsOf(root)) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "Raw log asked for a root that was not reported", { projectFolder: project.folder, root });
    return;
  }
  const file = await readRawLogFile(deps, project, root);
  if (!file) {
    await vscode.window.showInformationMessage(NO_RAW_LOG_MESSAGE);
    return;
  }
  if (!await openOrReport(deps, file, 1, { root })) { return; }
  await logger.log("INFO", PREVIEW_LOG_MODULE, "Opened raw build log", { projectFolder: project.folder, root, file });
}

export function createWritingActions(deps: WritingActionsDeps): WritingActions {
  return {
    recompile: async () => { await deps.recompile(deps.project.folder, deps.shownRoot()); },
    revealCursor: () => revealCursor(deps),
    openProblem: (root, index) => openProblem(deps, root, index),
    openRawLog: (root) => openRawLog(deps, root),
  };
}

export interface BuildRootBuildState {
  state: BuildState;
  errors: number;
}

export class BuildRootBuilds {
  private readonly problems = new Map<string, readonly LocatedProblem[]>();
  // INVARIANT: the cites of a root's last successful Typst build, i.e. of the PDF a preview shows; a failed build leaves them.
  private readonly cites = new Map<string, readonly TypstCitation[]>();
  // A preview opened during a build or after a failed one shows that state at once.
  private readonly states = new Map<string, BuildRootBuildState>();
  // The roots each project has built, in build order; the reader lists exactly these.
  private readonly built = new Map<string, Set<string>>();

  constructor(private readonly paths: PathOps) {}

  started(projectFolder: string, root: string): void {
    this.states.set(this.paths.join(projectFolder, root), { state: "building", errors: 0 });
  }

  /** Records a finished build and returns the number of errors it reported. */
  finished(projectFolder: string, root: string, result: FinishedBuild): number {
    const key = this.paths.join(projectFolder, root);
    this.problems.set(key, result.problems);
    this.built.set(projectFolder, (this.built.get(projectFolder) ?? new Set<string>()).add(root));
    const errors = result.problems.filter((problem) => problem.severity === "error").length;
    if (result.status === "failed") {
      this.states.set(key, { state: "failed", errors });
      return errors;
    }
    this.states.delete(key);
    if ("cites" in result) { this.cites.set(key, result.cites); }
    return errors;
  }

  /** The running or failed build of a root; undefined once its last build succeeded. */
  stateOf(projectFolder: string, root: string): BuildRootBuildState | undefined {
    return this.states.get(this.paths.join(projectFolder, root));
  }

  /** The problems of a root's last build, or undefined when the project has not built that root. */
  problemsOf(projectFolder: string, root: string): readonly LocatedProblem[] | undefined {
    return this.built.get(projectFolder)?.has(root) ? this.problems.get(this.paths.join(projectFolder, root)) : undefined;
  }

  citesOf(projectFolder: string, root: string): readonly TypstCitation[] | undefined {
    return this.cites.get(this.paths.join(projectFolder, root));
  }

  builtRoots(projectFolder: string): Iterable<string> {
    return this.built.get(projectFolder) ?? [];
  }
}
