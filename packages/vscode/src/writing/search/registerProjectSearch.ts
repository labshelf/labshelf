// Registers the Project Search panel and the command that focuses it, seeded with the editor's selection.
import * as vscode from "vscode";

import type { WritingHost, WritingProjects } from "../session/index.js";
import type { ProjectFinder } from "../buildRootDocument.js";
import { PROJECT_SEARCH_VIEW, ProjectSearchView } from "./projectSearchView.js";

const SEARCH_IN_PROJECT_COMMAND = "labshelf.writing.searchInProject";

interface ProjectSearchDeps {
  context: vscode.ExtensionContext;
  projects: ProjectFinder & Pick<WritingProjects, "fs">;
  host: WritingHost;
}

function selectedQuery(editor: vscode.TextEditor | undefined): string {
  if (!editor) { return ""; }
  const { selection, document } = editor;
  return selection.isEmpty || !selection.isSingleLine ? "" : document.getText(selection);
}

export function registerProjectSearch({ context, projects, host }: ProjectSearchDeps): void {
  const view = new ProjectSearchView({ extensionUri: context.extensionUri, projects, host });
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider(PROJECT_SEARCH_VIEW, view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand(SEARCH_IN_PROJECT_COMMAND, async () => {
      const query = selectedQuery(vscode.window.activeTextEditor);
      if (query !== "") { view.seed(query); }
      await vscode.commands.executeCommand(`${PROJECT_SEARCH_VIEW}.focus`);
    }),
  );
}
