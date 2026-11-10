// The state of each code listing of a manuscript in the native editor: marks, hover, "Update from code" and "Show differences", refreshed as the code files change.
// CONTRACT: documents/contracts/library-format.md#code-listings
import * as vscode from "vscode";

import { CODE_FILE_GLOB, buildCodeUpdate, describeCodeLinkState, diffCodeLink, resolveCodeLinks, type ILogger, type ResolvedCodeLink } from "@labshelf/core";
import { createCodeLinkSource, isCodeFile } from "../codeSource.js";
import { findCitingProject } from "./backlinks.js";
import { readManuscriptLanguage } from "./linkMarks.js";
import { ManuscriptMarks, registerManuscriptMarks, type MarkedView, type MarkKind } from "./manuscriptMarks.js";
import { registerCodeInsert } from "./codeInsert.js";
import type { ActiveSource } from "../activeSource.js";
import type { WritingProjects } from "../projects/index.js";

const REFRESH_DELAY_MS = 300;

export interface CodeLinkDeps {
  projects: Pick<WritingProjects, "list" | "paths" | "fs">;
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
        const resolved = await resolveCodeLinks(language, document.getText(), createCodeLinkSource(deps.projects.paths, project.folder));
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

/** Registers the marks on code listings, their hover, "Update from code" and "Show differences", and the two Insert Code commands. */
export function registerCodeLinks(context: vscode.ExtensionContext, deps: CodeLinkDeps): void {
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
}
