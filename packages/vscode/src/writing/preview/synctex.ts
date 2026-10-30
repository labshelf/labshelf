// Links a build preview and its source through SyncTeX: opens the source behind a point, adds a review note there and scrolls the preview to a source line.
import * as vscode from "vscode";

import { findPagePoint, findSourcePosition, formatError, type ILogger, type PagePoint, type PathOps, type SynctexFinder } from "@labshelf/core";
import { addSourceComment } from "../../collab/index.js";
import type { ActiveSource } from "../activeSource.js";
import { BUILD_COMMAND, readActiveProject } from "../build/index.js";
import type { WritingProjects } from "../projects/index.js";
import { NOT_BUILT_MESSAGE, NOT_IN_PREVIEW_MESSAGE, NO_SOURCE_MESSAGE, PREVIEW_LOG_MODULE, TYPST_SOURCE_LINKS_MESSAGE, readBuiltPdf, type BuildPreviews } from "./panel.js";


function editorColumn(): vscode.ViewColumn {
  return vscode.window.visibleTextEditors.find((editor) => editor.viewColumn !== undefined)?.viewColumn ?? vscode.ViewColumn.One;
}

/** Puts the cursor at the start of the 1-based `line` of `file` and shows that line in the middle of the editor, in an editor column, so the source never replaces the preview. An open LabShelf editor on the file (found through `views`) is revealed instead of opening a text editor. */
export async function openSourceLine(file: string, line: number, views?: Pick<ActiveSource, "openFor">): Promise<void> {
  const open = views?.openFor(vscode.Uri.file(file));
  if (open) {
    open.reveal(line);
    return;
  }
  const position = Math.max(0, line - 1);
  const range = new vscode.Range(position, 0, position, 0);
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: editorColumn(), selection: range });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

/** What opening the source behind a point of the preview needs. */
export interface ShowSourceDeps {
  logger: ILogger;
  paths: PathOps;
  projectFolder: string;
  synctex: () => Promise<SynctexFinder>;
  /** The open LabShelf editors reverse search reveals in; absent, the source opens in a text editor. */
  activeSource?: Pick<ActiveSource, "openFor">;
}

/** Opens the source line behind a point of the build preview, found through the project's SyncTeX data. */
export async function showSource(deps: ShowSourceDeps, point: PagePoint): Promise<void> {
  const { logger, projectFolder } = deps;
  const lookup = await deps.synctex();
  if (lookup.status === "unsupported") {
    await vscode.window.showInformationMessage(TYPST_SOURCE_LINKS_MESSAGE);
    return;
  }
  if (lookup.status !== "found") {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No SyncTeX data for the preview", { projectFolder, page: point.page, reason: lookup.status });
    await vscode.window.showInformationMessage(NOT_BUILT_MESSAGE);
    return;
  }
  const source = findSourcePosition(lookup.index, point);
  if (!source) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No source found at the clicked point", { projectFolder, page: point.page, x: point.x, y: point.y });
    await vscode.window.showInformationMessage(NO_SOURCE_MESSAGE);
    return;
  }
  try {
    await openSourceLine(source.file, source.line, deps.activeSource);
    await logger.log("INFO", PREVIEW_LOG_MODULE, "Opened source from the preview", { projectFolder, file: source.file, line: source.line, page: point.page });
  } catch (error) {
    await logger.error(PREVIEW_LOG_MODULE, error, { projectFolder, file: source.file, line: source.line, page: point.page });
    await vscode.window.showInformationMessage(`Could not open ${deps.paths.basename(source.file)}.`);
  }
}

const NO_SOURCE_LINE_MESSAGE = "No source line found for this text, so the note was not added. Comment on the source in the editor.";

/** Adds a review note from the build preview as a comment thread at the source line SyncTeX finds behind its point. */
export async function addPreviewComment(deps: ShowSourceDeps, point: PagePoint, quote: string, note: string): Promise<void> {
  const { logger, projectFolder } = deps;
  const context = { projectFolder, page: point.page, x: point.x, y: point.y };
  const lookup = await deps.synctex();
  const source = lookup.status === "found" ? findSourcePosition(lookup.index, point) : undefined;
  if (!source) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No source found for a review note", { ...context, reason: lookup.status === "found" ? "no hit" : lookup.status });
    void vscode.window.showInformationMessage(lookup.status === "found" ? NO_SOURCE_LINE_MESSAGE : NOT_BUILT_MESSAGE);
    return;
  }
  try {
    await addSourceComment({ projectFolder, file: source.file, line: source.line, quote, body: note });
    await openSourceLine(source.file, source.line, deps.activeSource);
  } catch (error) {
    await logger.error(PREVIEW_LOG_MODULE, error, { ...context, action: "add a review note", file: source.file, line: source.line });
    void vscode.window.showErrorMessage(`LabShelf could not add the note to ${deps.paths.basename(source.file)}: ${formatError(error)}`);
  }
}

/** What scrolling a build preview to a source line needs. */
export interface ShowInPreviewDeps {
  logger: ILogger;
  projectFolder: string;
  synctex: () => Promise<SynctexFinder>;
  reveal: (point: PagePoint) => void;
}

/** Scrolls a build preview to the output of a source line (1-based `line`), found through the project's SyncTeX data. */
export async function showInPreview(deps: ShowInPreviewDeps, file: string, line: number): Promise<void> {
  const { logger, projectFolder } = deps;
  const lookup = await deps.synctex();
  const point = lookup.status === "found" ? findPagePoint(lookup.index, file, line) : undefined;
  if (!point) {
    await logger.log("WARN", PREVIEW_LOG_MODULE, "No preview position for the source line", { projectFolder, file, line, reason: lookup.status });
    const message = lookup.status === "found" ? NOT_IN_PREVIEW_MESSAGE : lookup.status === "unsupported" ? TYPST_SOURCE_LINKS_MESSAGE : NOT_BUILT_MESSAGE;
    await vscode.window.showInformationMessage(message);
    return;
  }
  deps.reveal(point);
  await logger.log("INFO", PREVIEW_LOG_MODULE, "Revealed source line in the preview", { projectFolder, file, line, page: point.page });
}

const SHOW_IN_PREVIEW_COMMAND = "labshelf.writing.showInPreview";

interface ShowInPreviewCommandDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
  previews: Pick<BuildPreviews, "show" | "revealSource">;
  /** The focused source editor, native or LabShelf. */
  activeSource: Pick<ActiveSource, "current">;
}

async function showInPreviewAtCursor(deps: ShowInPreviewCommandDeps): Promise<void> {
  const source = deps.activeSource.current();
  const file = source?.uri;
  const project = readActiveProject(deps.projects, deps.activeSource);
  const pdf = await readBuiltPdf(deps.projects, project, project?.main);
  if (!source || !file || !project?.main || !pdf) {
    // The build command opens the preview on success and explains a missing project, main file or format.
    await vscode.commands.executeCommand(BUILD_COMMAND);
    return;
  }
  deps.previews.show(project, project.main, pdf, { beside: true });
  await deps.previews.revealSource(project, file.fsPath, source.line());
}

/** Registers Show in Preview: scrolls the active project's preview to the output of the line under the cursor of the focused source editor. */
export function registerShowInPreview(deps: ShowInPreviewCommandDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(SHOW_IN_PREVIEW_COMMAND, () => showInPreviewAtCursor(deps)));
}
