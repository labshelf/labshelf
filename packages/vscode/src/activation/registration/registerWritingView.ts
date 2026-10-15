// Registers the Writing sidebar view, its project commands and the main-document status bar item, and reloads the project list when the library root changes.
import * as vscode from "vscode";

import {
  WritingProjects, WritingTreeProvider, registerMainCommands, registerMainStatusBar, registerProjectCommands,
  registerProjectItemCommands, type WritingHost,
} from "../../writing/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";

export function registerWritingView(context: vscode.ExtensionContext, controller: LibraryRootController): void {
  const current = (): ReturnType<WritingHost["current"]> => {
    const root = controller.currentRoot();
    const services = controller.currentServices();
    return root && services ? { root: root.fsPath, logger: services.logger } : undefined;
  };
  const host: WritingHost = {
    current,
    // Offers the library setup when none is configured.
    require: async () => { await controller.require(); return current(); },
  };

  const projects = new WritingProjects(host);
  const provider = new WritingTreeProvider(projects);
  context.subscriptions.push(
    projects,
    provider,
    vscode.window.createTreeView("labshelf.writing", { treeDataProvider: provider }),
    controller.onDidChangeRoot(() => void projects.reload()),
  );
  registerProjectCommands({ context, host, projects });
  registerProjectItemCommands({ context, host, projects });
  registerMainCommands({ context, host, projects });
  registerMainStatusBar(context, projects);
  void projects.reload();
}
