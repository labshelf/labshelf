// Answers a preview reader's writing actions: recompile the shown root, show the editor cursor, open a problem's source and a root's raw log.
import * as vscode from "vscode";

import type { ILogger, LocatedProblem, PreviewPorts } from "@labshelf/core";
import type { ReadyProject } from "../../buildRootDocument.js";
import { openSourceLine } from "../synctex/index.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import { readActiveProjectEditor } from "./readActiveProjectEditor.js";
import { readRawLogFile, type RawLogDeps } from "./readRawLogFile.js";

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
