// Registers the Library sidebar webview and the helpers other registration modules use to sync or refresh it.
import * as vscode from "vscode";

import { libraryLayout } from "@labshelf/core";
import { LibrarySidebarView, type SidebarProjectsDep } from "../../ui/library/index.js";
import type { LibraryNode } from "../../ui/library/index.js";
import { ListWebviewPanel } from "../../ui/list/index.js";
import { importPapers, moveFolders, type FolderCommandHost } from "../../commands/index.js";
import type { LibraryEvents } from "../../events/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

export interface LibrarySidebarDeps {
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  controller: LibraryRootController;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  adapters: HostAdapters;
  /** The writing projects the Projects section lists. */
  projects: SidebarProjectsDep;
}

export interface LibrarySidebarHandles {
  librarySidebar: LibrarySidebarView;
  /** Selects the folder the list panel shows. */
  showFolderInSidebar: (folder?: LibraryNode) => void;
  /** Selects a paper's row; called when the list panel selects a paper. */
  showPaperInSidebar: (paperId: string) => void;
  refreshLibraryViews: () => void;
}

export function registerLibrarySidebar(deps: LibrarySidebarDeps): LibrarySidebarHandles {
  const { context, events, controller, papersRootUri, folderHost, adapters, projects } = deps;
  const view = new LibrarySidebarView({
    extensionUri: context.extensionUri,
    getSnapshot: () => controller.currentServices()?.library.snapshot,
    events,
    paths: adapters.paths,
    projects,
    importFiles: async (uris, targetDir) => {
      const services = await folderHost.requireServices();
      if (services) { await importPapers(services, uris, targetDir); }
    },
    moveFolder: (sourceDir, targetDir) => moveFolders(folderHost, [sourceDir], targetDir),
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("labshelf.library", view));
  const initialRoot = papersRootUri();
  if (initialRoot) { view.setLibrary(initialRoot); }
  controller.onDidChangeRoot(({ root }) => {
    view.setLibrary(libraryLayout(root, vscode.Uri.joinPath).papersRoot());
  });

  return {
    librarySidebar: view,
    showFolderInSidebar: (folder) => { if (folder) { view.showFolder(folder); } },
    showPaperInSidebar: (paperId) => view.showPaper(paperId),
    // Folder structure changed on disk: refresh both the sidebar and the open panel.
    refreshLibraryViews: () => {
      view.refresh();
      void ListWebviewPanel.currentPanel?.refresh();
    },
  };
}
