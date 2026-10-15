// Builds and registers the Library sidebar tree, its drag-and-drop controller and the view-sync/refresh helpers other
// registration modules need.
import * as vscode from "vscode";

import { libraryLayout } from "@labshelf/core";
import { LibraryTreeDataProvider, LibraryDragAndDropController } from "../../ui/library/index.js";
import type { LibraryNode } from "../../ui/library/index.js";
import { ListWebviewPanel } from "../../ui/list/index.js";
import { importPapers, moveFolders, type FolderCommandHost } from "../../commands/index.js";
import type { EventBus } from "../../events/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

export interface LibraryTreeViewDeps {
  context: vscode.ExtensionContext;
  eventBus: EventBus;
  controller: LibraryRootController;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  adapters: HostAdapters;
}

export interface LibraryTreeViewHandles {
  libraryProvider: LibraryTreeDataProvider;
  syncTreeToPanel: (folder?: LibraryNode) => void;
  refreshLibraryViews: () => void;
}

export function registerLibraryTreeView(deps: LibraryTreeViewDeps): LibraryTreeViewHandles {
  const { context, eventBus, controller, papersRootUri, folderHost, adapters } = deps;

  // Library folder tree mirrors the real directory structure under papers/.
  const libraryProvider = new LibraryTreeDataProvider(papersRootUri(), controller.currentServices()?.folderReader ?? null, eventBus, adapters.paths);
  controller.onDidChangeRoot(({ root, services }) => {
    libraryProvider.setLibrary(libraryLayout(root, vscode.Uri.joinPath).papersRoot(), services.folderReader);
  });

  const libraryDnD = new LibraryDragAndDropController(async (uris, targetDir) => {
    const services = await folderHost.requireServices();
    if (services) { await importPapers(services, uris, targetDir); }
  }, (sourceDirs, targetDir) => moveFolders(folderHost, sourceDirs, targetDir));

  libraryProvider.setPaperPathSource(async () => {
    const services = controller.currentServices();
    return services ? (await services.paperService.listPapers()).map((p) => p.path) : [];
  });

  const libraryTreeView = vscode.window.createTreeView("labshelf.library", {
    treeDataProvider: libraryProvider,
    dragAndDropController: libraryDnD,
    showCollapseAll: true,
  });
  context.subscriptions.push(libraryTreeView);
  // From here an empty Library view really is empty: switch its welcome text from loading to "No folders yet".
  void vscode.commands.executeCommand("setContext", "labshelf.libraryLoaded", true);

  // Keeps the tree selection on the folder the list panel shows. reveal() would
  // force the sidebar open, so a hidden tree is synced when it becomes visible instead.
  const syncTreeToPanel = (folder?: LibraryNode): void => {
    if (!folder || !libraryTreeView.visible) { return; }
    libraryTreeView.reveal(folder, { select: true, focus: false, expand: true }).then(undefined, () => {
      // The folder may have just been removed; a stale selection is harmless.
    });
  };
  context.subscriptions.push(
    libraryTreeView.onDidChangeVisibility((e) => {
      if (e.visible) { syncTreeToPanel(ListWebviewPanel.currentPanel?.currentFolder); }
    }),
  );

  // Folder structure changed on disk: refresh both the tree and the open panel.
  const refreshLibraryViews = (): void => {
    libraryProvider.refresh();
    void ListWebviewPanel.currentPanel?.refresh();
  };

  return { libraryProvider, syncTreeToPanel, refreshLibraryViews };
}
