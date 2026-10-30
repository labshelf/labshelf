// Tells an open preview about a project's build roots: their problems, raw logs and preprints, and answers the reader's writing actions.
import * as vscode from "vscode";

import {
  deriveProjectPath,
  checkBibliography,
  createBuildRootsMessage,
  deriveBuildRootFolder,
  derivePreviewProblems,
  isInside,
  lineAt,
  type BuildOptions,
  type ILogger,
  type LocatedProblem,
  type PathOps,
  type PdfProblem,
  type PreviewBuildRoot,
  type PreviewBuildRoots,
  type PreviewPorts,
  type ProjectContentPort,
  type PublishedVersionFinder,
} from "@labshelf/core";
import type { ActiveSource, SourceView } from "../activeSource.js";
import type { ReadyProject } from "../projects/index.js";
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
function readActiveProjectEditor(paths: PathOps, folder: string): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri;
  return editor && uri?.scheme === "file" && isInside(paths, folder, uri.fsPath) ? editor : undefined;
}

/** The focused source editor (native or LabShelf, from `activeSource`; else the active text editor) when its file is inside the project folder. */
export function readActiveProjectSource(paths: PathOps, folder: string, activeSource?: Pick<ActiveSource, "current">): Pick<SourceView, "uri" | "line"> | undefined {
  if (!activeSource) {
    const editor = readActiveProjectEditor(paths, folder);
    return editor ? { uri: editor.document.uri, line: () => editor.selection.active.line + 1 } : undefined;
  }
  const view = activeSource.current();
  return view?.uri.scheme === "file" && isInside(paths, folder, view.uri.fsPath) ? view : undefined;
}

/** The root the focused project source builds into; the project's main root when no project file is focused. */
export async function readFocusedBuildRoot(paths: PathOps, buildRootOf: BuildRootOf, project: ReadyProject, activeSource?: Pick<ActiveSource, "current">): Promise<string> {
  const main = project.main ?? "";
  const source = readActiveProjectSource(paths, project.folder, activeSource);
  return source ? await buildRootOf(project.folder, main, source.uri.fsPath) : main;
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
  return createBuildRootsMessage({
    main: input.project.main ?? input.shown, focused: input.focused, shown: input.shown, roots,
    limits: input.project.settings.check ?? {}, checks: input.checks, options: input.options,
  });
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
  /** The focused source editor, native or LabShelf; absent, the active text editor is the source. */
  activeSource?: Pick<ActiveSource, "current" | "openFor">;
}

const NO_EDITOR_MESSAGE = "Open a file of this project to show its cursor in the preview.";
const NO_RAW_LOG_MESSAGE = "This build kept no raw log.";

// Opens a file at a line; a failure is logged and shown, since the reader that asked has no way to report it.
async function openOrReport(deps: WritingActionsDeps, file: string, line: number, context: Record<string, unknown>): Promise<boolean> {
  try {
    await openSourceLine(file, line, deps.activeSource);
    return true;
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: deps.project.folder, file, line, ...context });
    void vscode.window.showErrorMessage(`Could not open ${deps.paths.basename(file)}.`);
    return false;
  }
}

async function revealCursor(deps: WritingActionsDeps): Promise<void> {
  const source = readActiveProjectSource(deps.paths, deps.project.folder, deps.activeSource);
  if (!source) {
    await vscode.window.showInformationMessage(NO_EDITOR_MESSAGE);
    return;
  }
  await deps.reveal(source.uri.fsPath, source.line());
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
