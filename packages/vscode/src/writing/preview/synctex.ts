// Links a build preview and its source through SyncTeX: opens the source behind a point, adds a review note there and scrolls the preview to a source line.
import * as vscode from "vscode";

import { deriveBuildRootFolder, findPagePoint, findSourcePosition, formatError, type ILogger, type PagePoint, type PathOps, type ProjectContentPort, type SynctexMap } from "@labshelf/core";
import { addSourceComment } from "../../collab/comments/index.js";
import { BUILD_COMMAND, readActiveProject } from "../build/index.js";
import type { ReadyProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import { NOT_BUILT_MESSAGE, NOT_IN_PREVIEW_MESSAGE, NO_SOURCE_MESSAGE, PREVIEW_LOG_MODULE, TYPST_SOURCE_LINKS_MESSAGE, readBuiltPdf, type BuildPreviews } from "./panel.js";

/** What the SyncTeX data of a project's build holds, or why it cannot be had. */
export type SynctexFinder =
  | { status: "found"; index: SynctexMap }
  | { status: "missing"; path: string }
  | { status: "unsupported" }
  | { status: "unreadable" };

/** Reads a project's SyncTeX data once per build and keeps it until the next build replaces it. */
export class ProjectSynctex {
  private readonly lookups = new Map<string, Promise<SynctexFinder>>();

  constructor(
    private readonly host: Pick<WritingHost, "current">,
    private readonly paths: PathOps,
    private readonly data: ProjectContentPort,
  ) {}

  /** Forgets the project's data; the next lookup reads the file the latest build wrote. */
  invalidate(projectFolder: string): void {
    this.lookups.delete(projectFolder);
  }

  /** The data of a root's build. A missing or unreadable file is not kept, so a later build is picked up. */
  load(project: ReadyProject, root: string | undefined): Promise<SynctexFinder> {
    const known = this.lookups.get(project.folder);
    if (known) { return known; }
    const pending = this.read(project, root);
    this.lookups.set(project.folder, pending);
    void pending.then((lookup) => {
      if (lookup.status !== "found" && this.lookups.get(project.folder) === pending) { this.lookups.delete(project.folder); }
    });
    return pending;
  }

  private async read(project: ReadyProject, root: string | undefined): Promise<SynctexFinder> {
    // Typst writes no SyncTeX; its compiler has no PDF-to-source map LabShelf can read.
    if (project.settings.format !== "latex") { return { status: "unsupported" }; }
    if (!root) { return { status: "missing", path: project.folder }; }
    const mainFile = this.paths.join(project.folder, root);
    try {
      const base = this.paths.basename(mainFile, this.paths.extname(mainFile));
      return await this.data.readSynctexFile(this.paths.join(this.data.projectBuildDir(project.settings.id), deriveBuildRootFolder(root)), base, this.paths.dirname(mainFile));
    } catch (error) {
      await this.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder });
      return { status: "unreadable" };
    }
  }
}

function editorColumn(): vscode.ViewColumn {
  return vscode.window.visibleTextEditors.find((editor) => editor.viewColumn !== undefined)?.viewColumn ?? vscode.ViewColumn.One;
}

/** Puts the cursor at the start of the 1-based `line` of `file` and shows that line in the middle of the editor, in an editor column, so the source never replaces the preview. */
export async function openSourceLine(file: string, line: number): Promise<void> {
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
    await openSourceLine(source.file, source.line);
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
    await openSourceLine(source.file, source.line);
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
}

async function showInPreviewAtCursor(deps: ShowInPreviewCommandDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const file = editor?.document.uri;
  const project = readActiveProject(deps.projects);
  const pdf = await readBuiltPdf(deps.projects, project, project?.main);
  if (!editor || !file || !project?.main || !pdf) {
    // The build command opens the preview on success and explains a missing project, main file or format.
    await vscode.commands.executeCommand(BUILD_COMMAND);
    return;
  }
  deps.previews.show(project, project.main, pdf, { beside: true });
  await deps.previews.revealSource(project, file.fsPath, editor.selection.active.line + 1);
}

/** Registers Show in Preview: scrolls the active project's preview to the output of the line under the editor cursor. */
export function registerShowInPreview(deps: ShowInPreviewCommandDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(SHOW_IN_PREVIEW_COMMAND, () => showInPreviewAtCursor(deps)));
}
