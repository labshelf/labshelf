// The state of each code listing of a manuscript in the native editor: marks, hover, "Update from code" and "Show differences", refreshed as the code files change.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";

import { CODE_FILE_GLOB, buildCodeUpdate, describeCodeLinkState, diffCodeLink, findCodeLinkLines, formatError, resolveCodeLinks, scanCodeLinks, type ILogger, type ResolvedCodeLink } from "@labshelf/core";
import { createCodeLinkSource, isCodeFile, openCodeFileAt, readCodeFile, resolveCodeFile, usePickedCodeFiles } from "../codeSource.js";
import { findCitingProject } from "./backlinks.js";
import { readManuscriptLanguage } from "./linkMarks.js";
import { ManuscriptMarks, registerManuscriptMarks, type MarkedView, type MarkKind } from "./manuscriptMarks.js";
import { registerCodeInsert } from "./codeInsert.js";
import type { ReaderCiteDeps } from "../../reader/index.js";
import type { ActiveSource } from "../activeSource.js";
import type { WritingProjects } from "../projects/index.js";

const REFRESH_DELAY_MS = 300;

export interface CodeLinkDeps {
  /** Also what the cite popup's IO reads and writes through, for Insert into Manuscript…. */
  projects: Pick<WritingProjects, "list" | "paths" | "fs"> & ReaderCiteDeps["projects"];
  logger: ILogger;
  activeSource: Pick<ActiveSource, "current" | "listOpen" | "onDidChange">;
}

/** One listing of a document at its opening comment. */
interface ListingView extends MarkedView {
  resolved: ResolvedCodeLink;
}

function createCodeMarkKind(deps: CodeLinkDeps): MarkKind<ListingView> {
  return {
    module: "writing/codeLinks",
    collection: "LabShelf code",
    source: "LabShelf code",
    diffScheme: "labshelf-code",
    updateTitle: "Update from code",
    updateCommand: "labshelf.writing.updateFromCode",
    diffCommand: "labshelf.writing.showCodeDiff",
    describe: (view) => describeCodeLinkState(view.resolved),
    prepare(document) {
      const language = readManuscriptLanguage(document);
      const project = language && findCitingProject(deps.projects, document.uri.fsPath);
      if (!language || !project) { return undefined; }
      return async () => {
        const resolved = await resolveCodeLinks(language, document.getText(), createCodeLinkSource(project.folder));
        return resolved.map((each): ListingView => {
          const content = document.lineAt(each.link.beginLine).text;
          return { resolved: each, line: each.link.beginLine, state: each.state, commentStart: Math.max(0, content.search(/\S/)), lineLength: content.length };
        });
      };
    },
    async buildUpdate(document, view) {
      const language = readManuscriptLanguage(document);
      return language ? buildCodeUpdate(language, document.getText(), view.resolved) : undefined;
    },
    async showDiff(diffs, document, view) {
      const { path } = view.resolved.link;
      const name = path.slice(path.lastIndexOf("/") + 1);
      const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
      const texts = diffCodeLink(view.resolved);
      await diffs.open(document.uri, { name: `manuscript${extension}`, text: texts.manuscript }, { name: `file${extension}`, text: texts.file }, `${name}: manuscript ↔ file`);
    },
  };
}

const OPEN_SOURCE_COMMAND = "labshelf.writing.openCodeSource";

/** An "Open source" lens on the opening comment of each listing of a manuscript in a project. */
function createOpenSourceLenses(deps: CodeLinkDeps): vscode.CodeLensProvider {
  return {
    provideCodeLenses(document) {
      const language = readManuscriptLanguage(document);
      if (!language || !findCitingProject(deps.projects, document.uri.fsPath)) { return []; }
      return scanCodeLinks(language, document.getText()).map((link) => new vscode.CodeLens(document.lineAt(link.beginLine).range, {
        title: "Open source", tooltip: `Open ${link.path} at the code this listing was copied from`, command: OPEN_SOURCE_COMMAND, arguments: [document.uri, link.beginLine],
      }));
    },
  };
}

/** Opens the file of the listing whose opening comment is on the 0-based `line`, at its definition or lines as they are now, or at the file's start when they are gone. */
async function openCodeSource(deps: CodeLinkDeps, uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const language = readManuscriptLanguage(document);
  const project = language && findCitingProject(deps.projects, document.uri.fsPath);
  const link = language && scanCodeLinks(language, document.getText()).find((each) => each.beginLine === line);
  if (!project || !link) { void vscode.window.showInformationMessage("This listing is no longer in the manuscript."); return; }
  const projectRoot = vscode.Uri.file(project.folder);
  const file = resolveCodeFile(projectRoot, link.path);
  const text = await readCodeFile(projectRoot, link.path).catch(() => undefined);
  await openCodeFileAt(file, text === undefined ? undefined : findCodeLinkLines(link, text)?.start);
}

/** Registers the marks on code listings, their hover, "Update from code" and "Show differences", the Open source lens and the two Insert Code commands, and keeps the picked code files in globalState. */
export function registerCodeLinks(context: vscode.ExtensionContext, deps: CodeLinkDeps): void {
  usePickedCodeFiles(context.globalState);
  const kind = createCodeMarkKind(deps);
  const marks = new ManuscriptMarks(kind, deps.logger);
  registerManuscriptMarks(context, marks, kind, deps.logger, (document) => isCodeFile(document.uri.fsPath));
  // Changes outside the editor (a git checkout, a script) refresh the open manuscripts once the code files are quiet.
  // Every file is watched and code files are picked here: the known extensions live in core's language table.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = vscode.workspace.createFileSystemWatcher(CODE_FILE_GLOB);
  const onCodeChange = (uri: vscode.Uri): void => {
    if (!isCodeFile(uri.fsPath)) { return; }
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(() => { timer = undefined; marks.refreshOpenDocuments(); }, REFRESH_DELAY_MS);
  };
  context.subscriptions.push(
    watcher, watcher.onDidChange(onCodeChange), watcher.onDidCreate(onCodeChange), watcher.onDidDelete(onCodeChange),
    { dispose: () => { if (timer) { clearTimeout(timer); } } },
  );
  registerCodeInsert(context, deps, (document) => { void marks.refresh(document); });
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider([{ scheme: "file", pattern: "**/*.tex" }, { scheme: "file", pattern: "**/*.typ" }], createOpenSourceLenses(deps)),
    vscode.commands.registerCommand(OPEN_SOURCE_COMMAND, async (uri: vscode.Uri, line: number) => {
      try {
        await openCodeSource(deps, uri, line);
      } catch (error) {
        void deps.logger.error("writing/codeLinks", error, { action: "openCodeSource" });
        void vscode.window.showErrorMessage(`Could not open the code: ${formatError(error)}`);
      }
    }),
  );
}
