// Builds and registers the Library sidebar tree, its drag-and-drop controller and the view-sync/refresh helpers other
// registration modules need.
import * as vscode from "vscode";

import { errorMessage, libraryLayout } from "@labshelf/core";
import { LibraryTreeDataProvider, LibraryDragAndDropController } from "../../ui/library/index.js";
import type { LibraryNode, LibraryTreeNode } from "../../ui/library/index.js";
import { ListWebviewPanel } from "../../ui/list/index.js";
import { importPapers, moveFolders, type FolderCommandHost } from "../../commands/index.js";
import { registerContinue } from "../../continue/index.js";
import type { LibraryEvents } from "../../events/index.js";
import type { WritingProjects } from "../../writing/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

const LOG_MODULE = "ui/library";

export interface LibraryTreeViewDeps {
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  controller: LibraryRootController;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  adapters: HostAdapters;
  projects: WritingProjects;
}

export interface LibraryTreeViewHandles {
  libraryProvider: LibraryTreeDataProvider;
  syncTreeToPanel: (folder?: LibraryNode) => void;
  /** Selects a paper's row when the tree is visible; called when the list panel selects a paper. */
  revealPaperInTree: (paperId: string) => void;
  refreshLibraryViews: () => void;
}

function createLibraryProvider(deps: LibraryTreeViewDeps): LibraryTreeDataProvider {
  const { context, events, controller, papersRootUri, adapters, projects } = deps;
  // Library folder tree mirrors the real directory structure under papers/.
  const continueSource = registerContinue({
    context,
    library: () => {
      const root = controller.currentRoot();
      const services = controller.currentServices();
      if (!root || !services) { return undefined; }
      return {
        root: root.fsPath,
        logger: services.logger,
        listPapers: () => services.paperService.listPapers(),
        loadSidecar: (paperId) => services.paperDataStore.load(paperId),
      };
    },
    projects,
  });
  const libraryProvider = new LibraryTreeDataProvider(papersRootUri(), () => controller.currentServices()?.library.snapshot, events, adapters.paths, continueSource, context.extensionUri);
  controller.onDidChangeRoot(({ root }) => {
    libraryProvider.setLibrary(libraryLayout(root, vscode.Uri.joinPath).papersRoot());
  });
  return libraryProvider;
}

function createLibraryTreeView(
  context: vscode.ExtensionContext, folderHost: FolderCommandHost, libraryProvider: LibraryTreeDataProvider,
): vscode.TreeView<LibraryTreeNode> {
  const libraryDnD = new LibraryDragAndDropController(async (uris, targetDir) => {
    const services = await folderHost.requireServices();
    if (services) { await importPapers(services, uris, targetDir); }
  }, (sourceDirs, targetDir) => moveFolders(folderHost, sourceDirs, targetDir));

  const libraryTreeView = vscode.window.createTreeView("labshelf.library", {
    treeDataProvider: libraryProvider,
    dragAndDropController: libraryDnD,
    showCollapseAll: true,
  });
  context.subscriptions.push(libraryTreeView);
  // From here an empty Library view really is empty: switch its welcome text from loading to "No folders yet".
  void vscode.commands.executeCommand("setContext", "labshelf.libraryLoaded", true);
  return libraryTreeView;
}

export function registerLibraryTreeView(deps: LibraryTreeViewDeps): LibraryTreeViewHandles {
  const libraryProvider = createLibraryProvider(deps);
  const libraryTreeView = createLibraryTreeView(deps.context, deps.folderHost, libraryProvider);

  // Keeps the tree selection on the folder the list panel shows. reveal() would
  // force the sidebar open, so a hidden tree is synced when it becomes visible instead.
  const syncTreeToPanel = (folder?: LibraryNode): void => {
    // The papers/ root has no row of its own: the list's All papers view selects nothing.
    if (!folder || folder.isRoot || !libraryTreeView.visible) { return; }
    libraryTreeView.reveal(folder, { select: true, focus: false, expand: true }).then(undefined, () => {
      // The folder may have just been removed; a stale selection is harmless.
    });
  };
  // The latest paper selected while the tree was hidden; selected once the tree becomes visible.
  let pendingPaperId: string | undefined;

  // Selecting the row this way does not run its command, so the list panel is not asked to reveal the paper again.
  const revealPaperInTree = (paperId: string): void => {
    if (!libraryTreeView.visible) {
      pendingPaperId = paperId;
      return;
    }
    pendingPaperId = undefined;
    const logger = deps.controller.currentServices()?.logger;
    const node = libraryProvider.paperNode(paperId);
    if (!node) {
      void logger?.log("WARN", LOG_MODULE, "Selected paper has no row in the Library tree", { paperId });
      return;
    }
    libraryTreeView.reveal(node, { select: true, focus: false, expand: true }).then(undefined, (error: unknown) => {
      void logger?.log("WARN", LOG_MODULE, "Could not reveal the paper in the Library tree", { paperId, message: errorMessage(error) });
    });
  };

  deps.context.subscriptions.push(
    libraryTreeView.onDidChangeVisibility((e) => {
      if (!e.visible) { return; }
      syncTreeToPanel(ListWebviewPanel.currentPanel?.currentFolder);
      if (pendingPaperId) { revealPaperInTree(pendingPaperId); }
    }),
  );

  // Folder structure changed on disk: refresh both the tree and the open panel.
  const refreshLibraryViews = (): void => {
    libraryProvider.refresh();
    void ListWebviewPanel.currentPanel?.refresh();
  };

  return { libraryProvider, syncTreeToPanel, revealPaperInTree, refreshLibraryViews };
}
